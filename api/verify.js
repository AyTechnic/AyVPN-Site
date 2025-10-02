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

// NEW: نام شیت کوپن
const COUPEN_SHEET_TITLE = 'Coupen';

// --- متغیر جدید: نام شیت تمدید ---
const RENEW_SHEET_TITLE = 'Renew';

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

// تابع محاسبه قیمت چند کاربره (تکرار از bot.js)
const calculateMultiUserPrice = (basePrice, users) => {
    const multiplier = 1 + (users - 1) * 0.5;
    return Math.round(basePrice * multiplier / 1000) * 1000;
};

// تابع اعمال تخفیف (تکرار از bot.js)
const applyCoupenDiscount = (originalAmount, coupenDetails) => {
    let finalAmount = originalAmount;
    let discountAmount = 0;
    
    if (coupenDetails) {
        if (coupenDetails.percent > 0) {
            discountAmount = Math.round(originalAmount * coupenDetails.percent / 100);
        } else if (coupenDetails.price > 0) {
            discountAmount = coupenDetails.price;
        }
        
        finalAmount = originalAmount - discountAmount;
        
        if (finalAmount < 1000) {
            finalAmount = 1000;
            discountAmount = originalAmount - 1000;
        }
    }
    
    return {
        finalAmount: finalAmount,
        discountAmount: discountAmount
    };
};

// NEW: تابع دریافت کوپن از شیت (تکرار از bot.js)
async function getCoupenDetails(doc, coupenCode) {
    if (!coupenCode) return null;
    try {
        const sheet = doc.sheetsByTitle[COUPEN_SHEET_TITLE];
        if (!sheet) return null;
        
        await sheet.loadHeaderRow(1); 
        const rows = await sheet.getRows();
        const coupenRow = rows.find(row => row.get('coupen').toLowerCase() === coupenCode.toLowerCase());

        if (coupenRow) {
            const expiryDate = coupenRow.get('expiryDate');
            const manyTimes = coupenRow.get('manyTimes');
            
            // بررسی تاریخ انقضا (این بررسی برای لحظه پرداخت است، نباید بگذرد)
            if (expiryDate && new Date(expiryDate) < new Date()) {
                return { error: 'تاریخ انقضا گذشته است.' };
            }
            
            // بررسی تعداد مجاز استفاده (در صورتی که محدود باشد)
            if (manyTimes && manyTimes !== 'unlimited' && parseInt(manyTimes) <= 0) {
                 return { error: 'ظرفیت استفاده به پایان رسیده است.' };
            }
            
            return {
                coupen: coupenRow.get('coupen'),
                percent: parseInt(coupenRow.get('percent')) || 0,
                price: parseInt(coupenRow.get('price')) || 0,
                manyTimes: manyTimes,
                row: coupenRow 
            };
        }
        
        return null;
    } catch (error) {
        console.error('Error fetching coupen details in verify:', error.message);
        return null; 
    }
}

// --- توابع ثبت اطلاعات و ارسال پیام (قبلی) ---
async function logPurchase(doc, sheetTitle, data) {
    // ... (منطق logPurchase)
    // ... (منطق logPurchase)
    
    // NOTE: Log to the main purchase sheet (30D, 60D, etc.)
    const sheet = doc.sheetsByTitle[sheetTitle];
    if (!sheet) {
        throw new Error(`Sheet ${sheetTitle} not found.`);
    }

    // اطمینان از بارگیری هدرهای صحیح
    await sheet.loadHeaderRow(1);

    await sheet.addRow({
        status: 'Active',
        link: data.userLink,
        trackingId: data.trackingId,
        purchaseDate: new Date().toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' }),
        name: data.name,
        email: data.email,
        chat_id: data.chat_id,
        phone: data.phone,
        coupen: data.coupenCode || '', // NEW: ثبت کوپن استفاده شده
        users: data.users || '1',
        renewalCount: 0,
        lastRenewalDate: 'N/A'
    });
}

async function logRenewal(doc, data) {
    // ... (منطق logRenewal)
    // ... (منطق logRenewal)
    
    // NOTE: Log to the Renew sheet
    const sheet = doc.sheetsByTitle[RENEW_SHEET_TITLE];
    if (!sheet) {
        throw new Error(`Renew sheet not found.`);
    }

    // اطمینان از بارگیری هدرهای صحیح
    await sheet.loadHeaderRow(1);

    await sheet.addRow({
        renewalIdentifier: data.renewalIdentifier,
        requestedPlan: data.requestedPlan,
        name: data.name,
        email: data.email,
        phone: data.phone,
        telegramUsername: data.telegramUsername || '',
        chat_id: data.chat_id,
        telegramId: data.telegramId,
        requestDate: new Date().toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' }),
        users: data.users || '1',
        description: data.description,
        purchaseDate: new Date().toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' }),
        amount: data.amount,
        coupenCode: data.coupenCode || '', // NEW: ثبت کوپن استفاده شده
        discountAmount: data.discountAmount || 0, // NEW: ثبت مبلغ تخفیف
        OriginalSheet: data.originalSheetTitle,
        trackingId: data.trackingId,
    });
}

function sendFinalMessage(chatId, userLink, amount, trackingId, coupenCode, discountAmount) {
    // ... (منطق ارسال پیام)
    // ... (منطق ارسال پیام)
    
    let messageText = '🎉 **خرید شما با موفقیت انجام شد!**\n\n';
    messageText += `* مبلغ پرداختی: **${amount.toLocaleString('fa-IR')} تومان**\n`;
    if (coupenCode && discountAmount > 0) {
        messageText += `* کد تخفیف: **${coupenCode}** (تخفیف: ${discountAmount.toLocaleString('fa-IR')} تومان)\n`;
    }
    messageText += `* شناسه پیگیری: \`${trackingId}\`\n`;
    messageText += `* لینک اشتراک: \`${userLink}\`\n\n`;
    messageText += 'جهت استفاده از اشتراک خود، لطفاً روی لینک زیر کلیک کنید:\n';

    const keyboard = [
        [{ text: '🔗 کپی لینک اشتراک', callback_data: `copy_link_${userLink}` }],
        [{ text: '⬅️ بازگشت به منو اصلی', callback_data: 'menu_main' }]
    ];
    
    bot.sendMessage(chatId, messageText, { 
        reply_markup: { inline_keyboard: keyboard }, 
        parse_mode: 'Markdown' 
    });
}

function sendAdminNotification(data) {
    // ... (منطق ارسال پیام ادمین)
    // ... (منطق ارسال پیام ادمین)

    let notification = `🔔 **خرید جدید - موفق**\n\n`;
    notification += `* پلن: ${data.requestedPlan}\n`;
    notification += `* تعداد کاربران: ${data.users}\n`;
    notification += `* مبلغ: **${data.amount.toLocaleString('fa-IR')} تومان**\n`;
    if (data.coupenCode) {
         notification += `* کد تخفیف: **${data.coupenCode}** (تخفیف: ${data.discountAmount.toLocaleString('fa-IR')} تومان)\n`;
    }
    notification += `* نام: ${data.name}\n`;
    notification += `* ایمیل: ${data.email}\n`;
    notification += `* تلفن: ${data.phone}\n`;
    notification += `* چت آیدی: \`${data.chat_id}\`\n`;
    notification += `* شناسه پیگیری: \`${data.trackingId}\`\n`;
    notification += `* لینک: \`${data.userLink}\`\n`;
    
    bot.sendMessage(ADMIN_CHAT_ID, notification, { parse_mode: 'Markdown' });
}


// --- تابع اصلی: تأیید پرداخت ---
module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        return res.status(405).send(renderErrorPage('Method Not Allowed', 'خطا در روش درخواست.'));
    }
    
    // دریافت پارامترهای query
    const { 
        Authority, 
        Status, 
        amount: paidAmountStr, 
        chat_id, 
        name, 
        email, 
        phone, 
        renewalIdentifier, 
        requestedPlan,
        coupenCode: userCoupenCode, // NEW: دریافت کوپن کد
        users: usersStr, // NEW: دریافت تعداد کاربران
        telegramUsername, 
        telegramId
    } = req.query;

    const paidAmount = Number(paidAmountStr);
    const users = parseInt(usersStr) || 1;
    const isRenewal = renewalIdentifier && renewalIdentifier.length > 0;

    if (Status !== 'OK' || !Authority) {
        // ... (منطق وضعیت ناموفق)
        return res.status(400).send(renderErrorPage('پرداخت ناموفق', '❌ متأسفانه، پرداخت با موفقیت انجام نشد یا لغو شد.'));
    }

    try {
        // --- ۱. تأیید پرداخت از زرین‌پال ---
        const verificationResponse = await fetch('https://api.zarinpal.com/pg/v4/payment/verify.json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                merchant_id: ZARINPAL_MERCHANT_ID,
                amount: paidAmount,
                authority: Authority,
            }),
        });

        const verificationResult = await verificationResponse.json();
        const verificationData = verificationResult.data;

        if (verificationResult.errors.length > 0 || verificationData.code !== 100) {
            // ... (منطق خطای تأیید پرداخت)
            console.error('Zarinpal Verification Error:', verificationResult.errors);
            return res.status(400).send(renderErrorPage('خطا در تأیید پرداخت', `❌ خطا در تأیید پرداخت: کد ${verificationData.code || verificationResult.errors.code}.`));
        }

        // --- ۲. محاسبه قیمت نهایی برای اعتبارسنجی ---
        
        // پیدا کردن قیمت پایه پلن
        let basePlanPrice = 0;
        const planPriceKeys = Object.keys(planToSheetMap).filter(key => planToSheetMap[key] === requestedPlan);

        if (planPriceKeys.length > 0) {
            basePlanPrice = Number(planPriceKeys[0]); // اولین قیمت منطبق با کد پلن
        } else {
             // اگر تمدید باشد، باید قیمت را از جای دیگر پیدا کرد. (در اینجا فرض می‌کنیم قیمت تمدید و خرید اولیه یکسان است)
             // اگر '1M' باشد، معادل 30D است
            const planDetails = planToSheetMap[Object.keys(planToSheetMap).find(key => planToSheetMap[key] === requestedPlan)] || null;
            if(planDetails){
                 basePlanPrice = Number(Object.keys(planToSheetMap).find(key => planToSheetMap[key] === requestedPlan));
            } else {
                // اگر پلن پیدا نشد، باید یک خطای داخلی رخ دهد
                throw new Error(`Could not determine base price for plan: ${requestedPlan}`);
            }
        }
        
        // محاسبه قیمت اولیه (بدون تخفیف)
        const originalAmount = calculateMultiUserPrice(basePlanPrice, users);

        // --- ۳. خواندن و اعمال کوپن از شیت برای اعتبارسنجی ---
        const doc = await getOrCreateDoc();
        const coupenDetails = await getCoupenDetails(doc, userCoupenCode);
        
        let finalExpectedAmount = originalAmount;
        let discountAmount = 0;
        let coupenError = null;
        
        if (userCoupenCode && coupenDetails) {
            if (coupenDetails.error) {
                coupenError = coupenDetails.error;
            } else {
                const discountResult = applyCoupenDiscount(originalAmount, coupenDetails);
                finalExpectedAmount = discountResult.finalAmount;
                discountAmount = discountResult.discountAmount;
            }
        }
        
        // --- ۴. اعتبارسنجی مبلغ پرداختی ---
        if (paidAmount < finalExpectedAmount) {
            // اگر مبلغ پرداختی کمتر از انتظار بود، مشکلی در محاسبه پیش آمده است.
            throw new Error(`Amount Mismatch. Paid: ${paidAmount}, Expected: ${finalExpectedAmount}. Coupen: ${userCoupenCode}`);
        }
        
        // اگر کاربر کوپن وارد کرده ولی نامعتبر بوده، ما قیمت کامل را انتظار داریم.
        // اگر کوپن معتبر بوده، ما قیمت تخفیف‌خورده را انتظار داریم.
        
        // --- ۵. ثبت نهایی اطلاعات ---
        
        const trackingId = verificationData.ref_id; // شناسه منحصر به فرد زرین‌پال
        const userLink = isRenewal ? renewalIdentifier : `link-${trackingId}-${Math.random().toString(36).substring(2, 6)}`;
        const purchaseData = {
            trackingId,
            userLink,
            name,
            email,
            chat_id,
            phone,
            requestedPlan,
            renewalIdentifier,
            users,
            description: isRenewal ? `تمدید پلن ${requestedPlan}` : `خرید پلن ${requestedPlan}`,
            coupenCode: coupenError ? '' : userCoupenCode, // اگر کوپن نامعتبر باشد، آن را ثبت نمی‌کنیم
            discountAmount: coupenError ? 0 : discountAmount,
            originalSheetTitle: requestedPlan, // برای تمدید
            amount: paidAmount // مبلغ نهایی پرداخت شده
        };

        if (isRenewal) {
            await logRenewal(doc, purchaseData);
            // NOTE: در تمدید، لینک ثابت می‌ماند
        } else {
            const sheetTitle = requestedPlan;
            await logPurchase(doc, sheetTitle, purchaseData);
            // NOTE: در خرید جدید، لینک جدید ثبت می‌شود
        }

        // --- ۶. به‌روزرسانی تعداد مجاز استفاده از کوپن (در صورت نیاز) ---
        if (!coupenError && coupenDetails && coupenDetails.manyTimes && coupenDetails.manyTimes !== 'unlimited') {
            const currentTimes = parseInt(coupenDetails.manyTimes);
            if (currentTimes > 0) {
                // به‌روزرسانی ردیف در شیت
                coupenDetails.row.set('manyTimes', currentTimes - 1);
                await coupenDetails.row.save();
            }
        }

        // --- ۷. ارسال پیام موفقیت‌آمیز ---
        sendFinalMessage(chat_id, userLink, paidAmount, trackingId, purchaseData.coupenCode, purchaseData.discountAmount);
        sendAdminNotification(purchaseData);
        
        // ... (ارسال صفحه موفقیت‌آمیز به کاربر)
        return res.status(200).send(renderSuccessPage(userLink, trackingId, paidAmount, purchaseData.coupenCode, purchaseData.discountAmount));

    } catch (error) {
        // ... (منطق خطای داخلی)
        console.error('Internal Verification/Logging Error:', error.message);
        bot.sendMessage(ADMIN_CHAT_ID, `⚠️ **خطای سیستم در تأیید پرداخت**\n\nTransaction: ${Authority}\nError: ${error.message}`, { parse_mode: 'Markdown' });
        return res.status(500).send(renderErrorPage('خطای سرور', '❌ خطای داخلی در ثبت سفارش. لطفاً با پشتیبانی تماس بگیرید.'));
    }
};

// ... (renderSuccessPage و renderErrorPage و سایر توابع کمکی) ...

function renderSuccessPage(userLink, trackingId, amount, coupenCode, discountAmount) {
    const amountText = amount.toLocaleString('fa-IR') + ' تومان';
    const discountText = discountAmount > 0 ? `<p><strong>مبلغ تخفیف:</strong> ${discountAmount.toLocaleString('fa-IR')} تومان (کد: ${coupenCode})</p>` : '';
    
    return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>خرید موفق - Ay Technic</title>
    <style>
        /* FONT & BASE STYLES */
        @font-face { font-family: 'Vazirmatn'; src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Bold.woff2') format('woff2'); font-weight: 700; font-display: swap; }
        @font-face { font-family: 'Vazirmatn'; src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Medium.woff2') format('woff2'); font-weight: 500; font-display: swap; }
        body { font-family: 'Vazirmatn', sans-serif; background-color: #f8f9fa; color: #212529; line-height: 1.6; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
        .container { background: #ffffff; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1); max-width: 600px; width: 90%; text-align: center; }
        h1 { color: #28a745; font-size: 2rem; margin-bottom: 15px; }
        .icon { font-size: 4rem; color: #28a745; margin-bottom: 20px; }
        p { margin-bottom: 10px; font-size: 1.1rem; }
        .subscription-box { background-color: #f2f9f3; border: 1px solid #c3e6cb; border-radius: 8px; padding: 15px; margin-top: 20px; text-align: left; position: relative;}
        .subscription-box code { display: block; overflow-wrap: break-word; font-size: 1rem; color: #00790d; }
        .actions { display: flex; justify-content: flex-end; margin-top: 10px; }
        .actions button { background-color: #00790d; color: white; border: none; padding: 8px 15px; border-radius: 5px; cursor: pointer; margin-right: 10px; font-family: 'Vazirmatn', sans-serif; display: flex; align-items: center; }
        .actions button:hover { background-color: #00560d; }
        .actions button svg { width: 18px; height: 18px; margin-left: 5px; }
        .actions button:last-child { margin-right: 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">🎉</div>
        <h1>خرید با موفقیت انجام شد!</h1>
        <p><strong>مبلغ پرداختی:</strong> ${amountText}</p>
        ${discountText}
        <p><strong>شناسه پیگیری (Tracking ID):</strong> ${trackingId}</p>
        <div class="subscription-box">
            <p style="margin: 0; font-weight: 700;">لینک اشتراک:</p>
            <code class="subscription-link" id="subLink">${userLink}</code>
            <div class="actions">
                <button id="copyBtn" title="کپی لینک"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"></path></svg>کپی</button>
                <button id="openBtn" title="باز کردن لینک"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h11c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"></path></svg>باز کردن</button>
            </div>
        </div>
        <p style="margin-top: 30px;">لینک اشتراک همچنین به ربات تلگرام شما ارسال شد.</p>
    </div>

    <script>
        document.getElementById('copyBtn').addEventListener('click', () => {
            const link = document.getElementById('subLink').textContent;
            navigator.clipboard.writeText(link).then(() => {
                alert('لینک اشتراک کپی شد!');
            }).catch(err => {
                console.error('Could not copy text: ', err);
            });
        });
        document.getElementById('openBtn').addEventListener('click', () => {
            const link = document.getElementById('subLink').textContent;
            window.open(link, '_blank');
        });
    </script>
</body>
</html>`;
}

function renderErrorPage(title, message) {
    // ... (منطق renderErrorPage)
    // ... (منطق renderErrorPage)
    return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - Ay Technic</title>
    <style>
        /* FONT & BASE STYLES */
        @font-face { font-family: 'Vazirmatn'; src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Bold.woff2') format('woff2'); font-weight: 700; font-display: swap; }
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
        <p>${message}</p>
        <p>اگر وجهی از حساب شما کسر شده است، ظرف حداکثر ۲ ساعت به صورت خودکار به حساب شما باز خواهد گشت.</p>
        <p>در صورت نیاز، با پشتیبانی **Ay Technic** تماس بگیرید.</p>
    </div>
</body>
</html>`;
}