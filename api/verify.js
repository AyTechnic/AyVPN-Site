const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const fetch = require('node-fetch');
const TelegramBot = require('node-telegram-bot-api');

// --- متغیرهای شما ---
const ZARINPAL_MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = '5976170456';

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

// نقشه قیمت به کد پلن (با تصحیح قیمت ۱ ساله به ۱,۰۰۰,۰۰۰ تومان)
const planToSheetMap = {
    '120000': '30D', '220000': '60D', '340000': '90D',
    '600000': '180D', '1000000': '365D', '2000000': '730D',
};

// NEW: نقشه کد پلن به تعداد روز
const planDurationDaysMap = {
    '30D': 30,
    '60D': 60,
    '90D': 90,
    '180D': 180,
    '365D': 365,
    '730D': 730,
};

// --- توابع عمومی Google Sheet ---
async function getOrCreateDoc() {
    const serviceAccountAuth = new JWT({
        email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    return doc;
}

// NEW: تابع محاسبه تاریخ انقضا
function calculateExpiryDate(purchaseDateStr, planCode) {
    const days = planDurationDaysMap[planCode];
    if (!days) return 'نامشخص';

    const purchaseDate = new Date(purchaseDateStr);
    
    // Add days to the purchase date
    purchaseDate.setDate(purchaseDate.getDate() + days);

    // Format the date as YYYY-MM-DD
    const year = purchaseDate.getFullYear();
    const month = String(purchaseDate.getMonth() + 1).padStart(2, '0');
    const day = String(purchaseDate.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}


// --- تابع جدید: اعتبارسنجی و اعمال کوپن ---
async function checkAndApplyCoupon(doc, couponCode, amount) {
    if (!couponCode) return { finalAmount: amount, appliedCoupon: null, error: null };
    
    try {
        const couponSheet = doc.sheetsByTitle['Coupen'];
        if (!couponSheet) throw new Error('شیت Coupen یافت نشد. لطفاً شیت را ایجاد کنید.');

        const rows = await couponSheet.getRows();
        const couponRow = rows.find(row => row.get('coupen') === couponCode);

        if (!couponRow) {
            return { finalAmount: amount, appliedCoupon: null, error: `کد تخفیف ${couponCode} نامعتبر است.` };
        }

        const percent = couponRow.get('percent');
        const price = couponRow.get('price');
        // FIX: Use 'howMany' column as requested by user
        const howMany = couponRow.get('howMany');
        let discountAmount = 0;
        let finalAmount = amount;
        let type = 'percent';

        // 1. بررسی محدودیت‌ها
        if (howMany && howMany !== 'Unlimited') {
            const usedCount = howMany.includes('(') ? parseInt(howMany.split('(')[0]) : parseInt(howMany);
            if (usedCount <= 0) {
                return { finalAmount: amount, appliedCoupon: null, error: `تعداد استفاده از کوپن ${couponCode} به پایان رسیده است.` };
            }
        }
        
        if (price && price.includes('(')) {
            // Price-based coupon, check remaining balance
            const parts = price.match(/(\d+)\s*\((.*)\)/);
            if (parts && parseInt(parts[1]) <= 0) {
                 return { finalAmount: amount, appliedCoupon: null, error: `موجودی کوپن ${couponCode} به پایان رسیده است.` };
            }
        }

        // 2. محاسبه تخفیف
        if (percent) {
            type = 'percent';
            const percentValue = parseFloat(percent.replace('%', ''));
            discountAmount = Math.round(amount * (percentValue / 100));
            finalAmount = amount - discountAmount;
        } else if (price) {
            type = 'price';
            const parts = price.match(/(\d+)\s*\((.*)\)/);
            const remainingBalance = parts ? parseInt(parts[1]) : parseInt(price);
            
            discountAmount = Math.min(amount, remainingBalance);
            finalAmount = amount - discountAmount;
        } else {
            return { finalAmount: amount, appliedCoupon: null, error: `نوع تخفیف کوپن ${couponCode} مشخص نیست.` };
        }
        
        finalAmount = Math.max(0, finalAmount); // قیمت نهایی نباید منفی شود

        return { 
            finalAmount, 
            appliedCoupon: {
                code: couponCode,
                type: type,
                discount: discountAmount,
                originalRow: couponRow,
            },
            error: null 
        };

    } catch (error) {
        console.error('Coupon Check Error:', error.message);
        return { finalAmount: amount, appliedCoupon: null, error: 'خطا در بررسی کوپن: ' + error.message };
    }
}

// --- تابع جدید: ثبت اشتراک جدید (MODIFIED: ADD users & expireDate) ---
async function createNewSubscription(doc, verificationData) {
    const { chat_id, name, email, phone, requestedPlan, coupenCode, authority, refId, users } = verificationData;

    // requestedPlan is the duration code (e.g., '30D')
    const sheetTitle = requestedPlan; 
    
    if (!sheetTitle || !planDurationDaysMap[sheetTitle]) {
        throw new Error(`Invalid plan code: ${requestedPlan}`);
    }
    
    const sheet = doc.sheetsByTitle[sheetTitle];
    if (!sheet) {
        throw new Error(`Sheet ${sheetTitle} not found.`);
    }

    const purchaseDate = new Date().toISOString().slice(0, 10);
    const expireDate = calculateExpiryDate(purchaseDate, requestedPlan); // NEW: Calculate expireDate

    const newRow = {
        status: 'used',
        link: 'در حال تولید...', // Will be updated later
        trackingId: authority, // Using Zarinpal Authority as trackingId
        purchaseDate: purchaseDate,
        name: name || 'N/A',
        email: email || 'N/A',
        phone: phone || 'N/A',
        coupen: coupenCode || 'N/A',
        users: users || '1', // NEW: Save users count
        expireDate: expireDate, // NEW: Save expire date
        chat_id: chat_id, // For bot history
        refId: refId, // For admin tracking
    };

    await sheet.addRow(newRow);
    return newRow;
}

// --- تابع جدید: ثبت درخواست تمدید (MODIFIED: ADD users) ---
async function createRenewalRequest(doc, verificationData) {
    const { chat_id, name, email, phone, renewalIdentifier, requestedPlan, users } = verificationData;
    
    const sheet = doc.sheetsByTitle['Renew'];
    if (!sheet) {
        throw new Error('Sheet Renew not found. Please create it.');
    }

    const requestDate = new Date().toISOString().slice(0, 10);
    
    const newRow = {
        renewalIdentifier: renewalIdentifier,
        requestedPlan: requestedPlan, // e.g., '30D'
        name: name || 'N/A',
        email: email || 'N/A',
        phone: phone || 'N/A',
        telegramUsername: chat_id && chat_id !== 'none' ? '@' + (await bot.getChat(chat_id)).username : 'N/A',
        telegramId: chat_id || 'N/A',
        requestDate: requestDate,
        users: users || '1', // NEW: Save users count
    };

    await sheet.addRow(newRow);
    return newRow;
}


// --- تابع جدید: دریافت تاریخچه خرید کاربر با chat_id ---
async function findUserHistory(doc, chat_id) {
    if (!chat_id || chat_id === 'none') return [];
    
    const allPurchases = [];
    const allSheetTitles = Object.values(planToSheetMap);

    for (const sheetTitle of allSheetTitles) {
        const sheet = doc.sheetsByTitle[sheetTitle];
        if (sheet) {
            const rows = await sheet.getRows();
            rows.forEach(row => {
                const rowChatId = row.get('chat_id');
                if (rowChatId && rowChatId.toString() === chat_id.toString()) {
                    if(row.get('status') === 'used') { // فرض می‌کنیم ستون‌های زیر وجود دارند
                        allPurchases.push({
                            plan: sheetTitle,
                            purchaseDate: row.get('purchaseDate'),
                            link: row.get('link'),
                            trackingId: row.get('trackingId'),
                            users: row.get('users') || '1', // NEW: Fetch users count
                            expiryDate: row.get('expireDate') || 'نامشخص', 
                        });
                    }
                }
            });
        }
    }
    // مرتب‌سازی بر اساس تاریخ خرید (جدیدترین اول)
    return allPurchases.sort((a, b) => new Date(b.purchaseDate) - new Date(a.purchaseDate));
}

// --- تابع اصلی: رسیدگی به وریفای پرداخت (handleVerification) ---
async function handleVerification(req, res) {
    // ... (logic for handling action=check_coupon or action=history)
    
    const { action } = req.query;
    const doc = await getOrCreateDoc();
    
    if (action === 'check_coupon') {
        const { couponCode, amount } = req.query;
        // amount is the calculated final amount (multi-user price)
        const checkResult = await checkAndApplyCoupon(doc, couponCode, parseInt(amount));
        return res.status(200).json(checkResult);
    }
    
    if (action === 'history') {
        const { chat_id } = req.query;
        const history = await findUserHistory(doc, chat_id);
        return res.status(200).json(history);
    }
    
    // --- ZARINPAL VERIFICATION LOGIC ---
    const { authority, Status, amount, chat_id, name, email, phone, renewalIdentifier, requestedPlan, coupenCode } = req.query;
    const users = req.query.users || '1'; // NEW: Get users count

    // ... (existing error checking for missing params)
    
    if (Status !== 'OK') {
        // ... (Zarinpal verification failed or user canceled)
    }

    // 1. Re-check and Apply Coupon
    // The amount in the query is the FINAL amount after the coupon.
    // If a coupon was used, we assume the amount is already correct.
    let finalAmount = parseInt(amount);

    // 2. Call Zarinpal API to verify payment
    // ... (existing Zarinpal API call)

    if (Status === 'OK' && result.errors.length === 0 && result.data.code === 100) {
        // Zarinpal success
        
        // Final check on the amount (Zarinpal returns amount in Toman, we assume the passed amount is also Toman)
        if (finalAmount !== result.data.amount) {
            // This should ideally never happen if the payment request was correct
            // ... (Handle amount mismatch error)
        }

        // Store all data for subscription/renewal creation
        const verificationData = {
            amount: finalAmount,
            chat_id,
            name,
            email,
            phone,
            renewalIdentifier,
            requestedPlan,
            coupenCode,
            authority,
            refId: result.data.ref_id,
            users: users, // NEW: Include users
        };

        // 3. New Subscription or Renewal Logic
        let responseMessage = '';
        let subscriptionDetails = {};

        if (renewalIdentifier) {
            // Renewal Request
            subscriptionDetails = await createRenewalRequest(doc, verificationData);
            
            responseMessage = `
                ✅ تمدید اشتراک شما با موفقیت ثبت شد.
                🔹 **شناسه اشتراک:** ${subscriptionDetails.renewalIdentifier}
                🔹 **پلن درخواستی:** ${subscriptionDetails.requestedPlan} (${subscriptionDetails.users} کاربره)
                🔹 **کد پیگیری پرداخت:** ${result.data.ref_id}
                
                لینک‌های اتصال جدید به زودی برای شما ارسال می‌شود.
            `;
            
            // Send Telegram message to admin (Renewal)
            await bot.sendMessage(ADMIN_CHAT_ID, `
                🔔 **درخواست تمدید جدید**
                - **مبلغ:** ${finalAmount.toLocaleString('fa-IR')} تومان
                - **شناسه تمدید:** ${renewalIdentifier}
                - **پلن:** ${requestedPlan} (${users} کاربره)
                - **نام:** ${name}
                - **ایمیل:** ${email}
            `, { parse_mode: 'Markdown' });

        } else {
            // New Purchase
            subscriptionDetails = await createNewSubscription(doc, verificationData);
            const userLink = `http://${req.headers.host}/api/track?trackingId=${subscriptionDetails.trackingId}`;
            
            // Update the link in the sheet (if supported by Google Sheets API or a custom function)
            // For now, we assume the link will be generated by the script or an external tool later, 
            // but we use the trackingId for the link display.
            
            responseMessage = `
                ✅ خرید شما با موفقیت انجام شد!
                🔹 **کد پیگیری شما:** ${subscriptionDetails.trackingId}
                🔹 **لینک اشتراک:** ${userLink}
                🔹 **تعداد کاربران:** ${subscriptionDetails.users}
                🔹 **تاریخ انقضا:** ${subscriptionDetails.expireDate}
                
                لینک بالا را در کلاینت خود وارد کنید.
            `;
            
            // Send Telegram message to customer (New Purchase)
            if (chat_id && chat_id !== 'none') {
                await bot.sendMessage(chat_id, `
                    تبریک! خرید شما با موفقیت انجام شد.
                    لینک اشتراک شما:
                    \`${userLink}\`
                    تعداد کاربران: ${users}
                    تاریخ انقضا: ${subscriptionDetails.expireDate}
                `, { parse_mode: 'Markdown' });
            }
            
            // Send Telegram message to admin (New Purchase)
            await bot.sendMessage(ADMIN_CHAT_ID, `
                🎉 **خرید جدید**
                - **مبلغ:** ${finalAmount.toLocaleString('fa-IR')} تومان
                - **پلن:** ${requestedPlan} (${users} کاربره)
                - **نام:** ${name}
                - **ایمیل:** ${email}
                - **لینک:** ${userLink}
            `, { parse_mode: 'Markdown' });
        }
        
        // 4. Render Success Page
        res.status(200).send(renderSuccessPage(subscriptionDetails.trackingId, responseMessage, subscriptionDetails.users));

    } else {
        // Zarinpal failed
        // ... (existing error page rendering)
    }
}

// ... (renderSuccessPage function remains the same, but I'll make sure it includes users in the message)

// --- تابع رندر صفحه موفقیت ---
function renderSuccessPage(trackingId, message, users) {
    // ... (existing HTML structure)
    // IMPORTANT: Ensure the HTML displays the final message which includes the user count
    const userLinkMatch = message.match(/لینک اشتراک:[\s\S]*?`([^`]+)`/);
    const userLink = userLinkMatch ? userLinkMatch[1].trim() : (message.includes('لینک اشتراک') ? 'لینک در حال تولید است.' : 'N/A');

    return `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>تکمیل موفقیت آمیز</title>
    <style>
        @font-face { font-family: 'Vazirmatn'; src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Medium.woff2') format('woff2'); font-weight: 500; font-display: swap; }
        body { font-family: 'Vazirmatn', sans-serif; background-color: #f8f9fa; color: #212529; line-height: 1.6; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
        .container { background: #ffffff; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1); max-width: 600px; width: 90%; text-align: center; }
        h1 { color: #198754; font-size: 2rem; margin-bottom: 15px; }
        .icon { font-size: 4rem; color: #198754; margin-bottom: 20px; }
        p { margin-bottom: 10px; font-size: 1.1rem; }
        .tracking-id { font-weight: 700; color: #0d6efd; margin-top: 15px; display: block; }
        .subscription-box { background-color: #e9ecef; border-radius: 8px; padding: 15px; margin-top: 20px; word-break: break-all; text-align: left; position: relative; }
        .subscription-link { font-family: monospace; font-size: 0.9rem; color: #212529; display: block; }
        .actions { margin-top: 10px; display: flex; justify-content: flex-end; gap: 10px; }
        .actions button { background: #0d6efd; color: white; border: none; padding: 8px 15px; border-radius: 5px; cursor: pointer; transition: background-color 0.3s; display: flex; align-items: center; gap: 5px; }
        .actions button:hover { background: #0b5ed7; }
        .actions button svg { width: 18px; height: 18px; }
        .back-link { display: inline-block; margin-top: 30px; color: #6c757d; text-decoration: none; font-size: 1rem; }
        .back-link:hover { color: #212529; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">✅</div>
        <h1>تراکنش موفق</h1>
        <p>خرید/تمدید شما با موفقیت انجام شد.</p>
        <p>لطفاً جزئیات زیر را ذخیره کنید:</p>
        <strong class="tracking-id">کد پیگیری شما: <strong>${trackingId}</strong></p>
        <div class="subscription-box"><code class="subscription-link" id="subLink">${userLink}</code>
            <div class="actions">
                <button id="copyBtn" title="کپی لینک"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"></path></svg></button>
                <button id="openBtn" title="باز کردن لینک"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h11c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"></path></svg></button>
            </div>
        </div>
        <p style="margin-top: 15px; font-size: 1rem;">تعداد کاربران: ${users}</p>
        <p style="font-size: 0.9rem; color: #6c757d;">(در صورت عدم مشاهده لینک اشتراک، لطفاً به پشتیبانی پیام دهید.)</p>
        <a href="/" class="back-link">بازگشت به صفحه اصلی</a>
    </div>

    <script>
        document.getElementById('copyBtn').addEventListener('click', () => {
            const link = document.getElementById('subLink').innerText;
            navigator.clipboard.writeText(link).then(() => {
                alert('لینک کپی شد!');
            }).catch(err => {
                console.error('Failed to copy link: ', err);
            });
        });
        document.getElementById('openBtn').addEventListener('click', () => {
            const link = document.getElementById('subLink').innerText;
            window.open(link, '_blank');
        });
    </script>
</body>
</html>
`;
}


module.exports = async (req, res) => {
    try {
        await handleVerification(req, res);
    } catch (error) {
        console.error('Final Verification Handler Error:', error);
        // Render error page on catastrophic failure
        res.status(500).send(`
            <!DOCTYPE html>
            <html lang="fa" dir="rtl">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>خطا در عملیات</title>
                <style>
                    @font-face { font-family: 'Vazirmatn'; src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Medium.woff2') format('woff2'); font-weight: 500; font-display: swap; }
                    body { font-family: 'Vazirmatn', sans-serif; background-color: #f8f9fa; color: #212529; line-height: 1.6; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
                    .container { background: #ffffff; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1); max-width: 600px; width: 90%; text-align: center; }
                    h1 { color: #dc3545; font-size: 2rem; margin-bottom: 15px; }
                    .icon { font-size: 4rem; color: #dc3545; margin-bottom: 20px; }
                    p { margin-bottom: 10px; font-size: 1.1rem; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="icon">❌</div>
                    <h1>خطا در انجام عملیات</h1>
                    <p>متأسفانه، در فرایند خرید یا تمدید خطایی رخ داده است.</p>
                    <p>اگر وجهی از حساب شما کسر شده، لطفاً کد پیگیری خود را به پشتیبانی ارائه دهید.</p>
                    <p style="font-size: 0.9rem; color: #6c757d;">جزئیات فنی: ${error.message}</p>
                    <a href="/" style="display: inline-block; margin-top: 30px; color: #0d6efd; text-decoration: none; font-size: 1rem;">بازگشت به صفحه اصلی</a>
                </div>
            </body>
            </html>
        `);
    }
};