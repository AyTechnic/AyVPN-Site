const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const fetch = require('node-fetch');
const TelegramBot = require('node-telegram-bot-api');

// --- ۱. متغیرهای شما ---
const ZARINPAL_MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '5976170456'; // ادمین آیدی را از متغیر محیطی بخوانید

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

// نقشه قیمت به کد پلن (با تصحیح قیمت ۱ ساله به ۱,۰۰۰,۰۰۰ تومان)
const planToSheetMap = {
    '120000': '30D', '220000': '60D', '340000': '90D',
    '600000': '180D', '1000000': '365D', '2000000': '730D',
};

// نقشه کد پلن به تعداد روز
const planDurationDaysMap = {
    '30D': 30, '60D': 60, '90D': 90, '180D': 180, '365D': 365, '730D': 730, 'Renew': 0 // برای تمدید روز صفر
};

// نام شیت‌های اصلی
const COUPEN_SHEET_TITLE = 'Coupen';
const RENEW_SHEET_TITLE = 'Renew'; 

// --- ۲. توابع عمومی Google Sheet ---

/**
 * ایجاد شیء سند گوگل شیت با احراز هویت سرویس اکانت
 * @returns {Promise<GoogleSpreadsheet>}
 */
async function getDoc() {
    const serviceAccountAuth = new JWT({
        email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: ['[https://www.googleapis.com/auth/spreadsheets](https://www.googleapis.com/auth/spreadsheets)'],
    });
    const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    return doc;
}

/**
 * یافتن کوپن معتبر در شیت Coupen
 * @param {string} coupenCode - کد کوپن وارد شده توسط کاربر
 * @returns {Promise<Object | null>} - شیء کوپن یا null اگر نامعتبر بود
 */
async function getCoupen(coupenCode) {
    if (!coupenCode) {
        return null;
    }

    try {
        const doc = await getDoc();
        const sheet = doc.sheetsByTitle[COUPEN_SHEET_TITLE];
        if (!sheet) {
            console.error(`Sheet not found: ${COUPEN_SHEET_TITLE}`);
            return null;
        }

        // اطمینان از بارگیری هدرهای صحیح
        await sheet.loadHeaderRow(1);
        const rows = await sheet.getRows();

        const row = rows.find(r => 
            // تبدیل هر دو به حروف کوچک برای جستجوی Case-Insensitive
            r.get('code') && r.get('code').toLowerCase() === coupenCode.toLowerCase()
        );

        if (row) {
            const isActive = row.get('active') && row.get('active').toLowerCase() === 'yes';
            const maxUses = parseInt(row.get('maxUses'), 10);
            const manyTimes = parseInt(row.get('manyTimes'), 10);
            
            // اعتبار سنجی نهایی
            if (isActive && manyTimes > 0) {
                return {
                    code: row.get('code'),
                    type: row.get('type') ? row.get('type').toLowerCase() : 'percent', // 'percent' یا 'fixed'
                    value: parseFloat(row.get('value')), // مقدار تخفیف (عدد)
                    manyTimes: manyTimes,
                    row: row // خود شیء سطر برای به‌روزرسانی بعدی
                };
            }
        }
        
        return null; // کوپن پیدا نشد یا نامعتبر بود
    } catch (error) {
        console.error('Error fetching coupen from sheet:', error.message);
        // در صورت بروز هرگونه خطای گوگل شیت، کوپن را نامعتبر در نظر می‌گیریم
        return null; 
    }
}

/**
 * محاسبه مبلغ نهایی بعد از اعمال کوپن
 * @param {number} originalAmount - مبلغ اصلی (به ریال)
 * @param {Object} coupon - شیء کوپن بازگشتی از getCoupen
 * @returns {number} - مبلغ نهایی (به ریال)
 */
function calculateFinalAmount(originalAmount, coupon) {
    if (!coupon || !originalAmount || originalAmount <= 0) {
        return originalAmount;
    }

    let discountValue = 0;
    
    if (coupon.type === 'percent') {
        discountValue = Math.round(originalAmount * (coupon.value / 100));
    } else if (coupon.type === 'fixed') {
        // value در شیت باید به ریال باشد (مثلاً ۵۰,۰۰۰ تومان = ۵۰۰,۰۰۰ ریال)
        discountValue = coupon.value;
    }

    let finalAmount = originalAmount - discountValue;

    // اطمینان از اینکه مبلغ نهایی کمتر از حداقل مجاز (مثلاً ۱۰۰۰ ریال) نشود
    if (finalAmount < 1000) {
        finalAmount = 1000;
    }
    
    return finalAmount;
}

// --- ۳. توابع کمکی HTML برای نمایش خطا/موفقیت ---

/**
 * تابع نمایش یک صفحه HTML خطا
 * @param {object} res - شیء Response
 * @param {string} title - عنوان صفحه
 * @param {string} message - پیام خطا
 */
function displayErrorPage(res, title, message) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(500).send(`
        <!DOCTYPE html>
        <html lang="fa" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${title} - Ay Technic</title>
            <style>
                /* FONT & BASE STYLES */
                @font-face { font-family: 'Vazirmatn'; src: url('[https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Bold.woff2](https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Bold.woff2)') format('woff2'); font-weight: 700; font-display: swap; }
                @font-face { font-family: 'Vazirmatn'; src: url('[https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Medium.woff2](https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Medium.woff2)') format('woff2'); font-weight: 500; font-display: swap; }
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
                <h1>${title}</h1>
                <p>${message}</p>
                <p>در صورت نیاز به راهنمایی، لطفاً به ربات تلگرام مراجعه کنید.</p>
            </div>
        </body>
        </html>
    `);
}

/**
 * تابع نمایش صفحه موفقیت آمیز
 * @param {object} res - شیء Response
 * @param {string} userLink - لینک اشتراک نهایی
 * @param {string} planDescription - شرح پلن خریداری شده
 * @param {string} trackingId - کد پیگیری سفارش
 */
function displaySuccessPage(res, userLink, planDescription, trackingId) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(`
        <!DOCTYPE html>
        <html lang="fa" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>خرید موفق - Ay Technic</title>
            <style>
                /* FONT & BASE STYLES */
                @font-face { font-family: 'Vazirmatn'; src: url('[https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Bold.woff2](https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Bold.woff2)') format('woff2'); font-weight: 700; font-display: swap; }
                @font-face { font-family: 'Vazirmatn'; src: url('[https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Medium.woff2](https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Medium.woff2)') format('woff2'); font-weight: 500; font-display: swap; }
                body { font-family: 'Vazirmatn', sans-serif; background-color: #f8f9fa; color: #212529; line-height: 1.6; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
                .container { background: #ffffff; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1); max-width: 600px; width: 90%; text-align: center; }
                h1 { color: #28a745; font-size: 2rem; margin-bottom: 15px; }
                .icon { font-size: 4rem; color: #28a745; margin-bottom: 20px; }
                p { margin-bottom: 15px; font-size: 1.1rem; }
                .subscription-box { background-color: #e9ecef; border-radius: 8px; padding: 15px; margin: 20px 0; display: flex; flex-direction: column; align-items: center; }
                .subscription-link { word-break: break-all; font-family: monospace; font-size: 1rem; color: #007bff; }
                .actions button { background-color: #007bff; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; margin: 5px; font-size: 1rem; transition: background-color 0.3s; display: inline-flex; align-items: center; gap: 5px;}
                .actions button:hover { background-color: #0056b3; }
                .actions button svg { width: 18px; height: 18px; }
                .tracking-id { font-weight: bold; color: #343a40; }
                .contact-link { color: #007bff; text-decoration: none; font-weight: 500; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="icon">✅</div>
                <h1>خرید موفق</h1>
                <p>تراکنش شما با موفقیت انجام شد. از خرید شما متشکریم!</p>
                <p>پلن خریداری شده: <strong>${planDescription}</strong></p>
                <p>کد پیگیری سفارش: <span class="tracking-id">${trackingId}</span></p>

                <div class="subscription-box">
                    <p style="margin-bottom: 5px;">لینک اشتراک شما:</p>
                    <code class="subscription-link" id="subLink">${userLink}</code>
                    <div class="actions">
                        <button id="copyBtn" title="کپی لینک"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"></path></svg> کپی</button>
                        <button id="openBtn" title="باز کردن لینک" onclick="window.open(document.getElementById('subLink').textContent, '_blank')"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h11c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"></path></svg> باز کردن</button>
                    </div>
                </div>

                <p>در صورت بروز مشکل، با پشتیبانی در <a class="contact-link" href="[https://t.me/shammay_support](https://t.me/shammay_support)" target="_blank">تلگرام</a> تماس بگیرید.</p>
            </div>
            
            <script>
                document.getElementById('copyBtn').addEventListener('click', function() {
                    const linkElement = document.getElementById('subLink');
                    navigator.clipboard.writeText(linkElement.textContent).then(() => {
                        alert('لینک کپی شد!');
                    }).catch(err => {
                        console.error('Could not copy text: ', err);
                    });
                });
            </script>
        </body>
        </html>
    `);
}


// --- ۴. تابع اصلی مدیریت درخواست (Verification Handler) ---

module.exports = async (req, res) => {
    // اطمینان از اینکه متد GET است (برای CallBack زرین‌پال)
    if (req.method !== 'GET') {
        return displayErrorPage(res, 'خطای متد', 'درخواست ارسالی نامعتبر است.');
    }

    // دریافت پارامترهای Query
    const { 
        Authority, Status, 
        amount, chat_id, name, email, phone, renewalIdentifier, requestedPlan, coupenCode, users 
    } = req.query;

    const originalAmount = parseInt(amount, 10);
    const usersCount = parseInt(users, 10) || 1;
    const isRenewal = renewalIdentifier && renewalIdentifier !== 'none';
    const finalCoupenCode = coupenCode && coupenCode !== 'none' ? coupenCode : null;

    if (!Authority || Status !== 'OK') {
        // وضعیت ناموفق از طرف زرین‌پال یا انصراف کاربر
        return displayErrorPage(res, 'تراکنش ناموفق', 'تراکنش شما موفقیت آمیز نبود یا توسط شما لغو شد.');
    }

    let couponInfo = null;
    let expectedAmount = originalAmount;
    let expectedFinalAmount = originalAmount;
    
    // --- الف: اعتبارسنجی کوپن ---
    if (finalCoupenCode) {
        // ۱. دریافت اطلاعات کوپن از شیت
        couponInfo = await getCoupen(finalCoupenCode);
        
        if (!couponInfo) {
            // ۲. اگر کوپن نامعتبر است، خطا نمایش داده شود
            const errorMessage = `کد تخفیف «${finalCoupenCode}» نامعتبر است یا ظرفیت استفاده از آن پر شده است. لطفاً با پشتیبانی تماس بگیرید.`;
            // ارسال پیام خطا به چت بات
            if (chat_id && chat_id !== 'none') {
                bot.sendMessage(chat_id, `❌ *خطا در پرداخت:*\n${errorMessage}`, { parse_mode: 'Markdown' });
            }
            return displayErrorPage(res, 'کد تخفیف نامعتبر', errorMessage);
        }
        
        // ۳. محاسبه مجدد مبلغ نهایی مورد انتظار
        // (اینجا انتظار می‌رود originalAmount همان مبلغ تخفیف‌خورده باشد که از start-payment آمده)
        expectedFinalAmount = calculateFinalAmount(originalAmount, couponInfo); 
        
        // **نکته مهم:** در این مرحله، originalAmount که از start-payment آمده *باید* همان مبلغ تخفیف خورده باشد.
        // اگر مبلغی که کاربر پرداخت کرده (که در verify زرین‌پال خواهد آمد) با originalAmount تفاوت داشته باشد،
        // یعنی کاربر در مرحله پرداخت مبلغ را دستکاری کرده است. اما ما باید اطمینان حاصل کنیم که 
        // مبلغی که زرین‌پال برمی‌گرداند (verify result) با مبلغ مورد انتظار ما برابر است.
        // برای سادگی، فعلاً فرض می‌کنیم مبلغ ارسالی از بات به start-payment و از start-payment به اینجا (originalAmount) صحیح است.
        // verification نهایی زرین پال صحت مبلغ را تایید می‌کند.
    }


    try {
        // --- ب: تأیید نهایی تراکنش با زرین‌پال ---
        const verificationResponse = await fetch('[https://api.zarinpal.com/pg/v4/payment/verify.json](https://api.zarinpal.com/pg/v4/payment/verify.json)', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                merchant_id: ZARINPAL_MERCHANT_ID,
                authority: Authority,
                amount: expectedFinalAmount, // استفاده از مبلغ نهایی مورد انتظار
            }),
        });

        const verificationResult = await verificationResponse.json();
        const data = verificationResult.data;

        if (verificationResult.errors.length > 0 || data.code !== 100) {
            // تأیید ناموفق
            const errorCode = verificationResult.errors.code || data.code;
            const errorMsg = `تأیید پرداخت ناموفق (کد خطا: ${errorCode}). در صورت کسر وجه، تا ۴۸ ساعت صبر کنید.`;

            console.error('Zarinpal Verification Failed:', verificationResult.errors, `Expected Amount: ${expectedFinalAmount}`);
            
            // ارسال پیام خطا به چت بات
            if (chat_id && chat_id !== 'none') {
                bot.sendMessage(chat_id, `❌ *تراکنش ناموفق:*\n${errorMsg}`, { parse_mode: 'Markdown' });
            }

            return displayErrorPage(res, 'تراکنش ناموفق', errorMsg);
        }


        // --- ج: موفقیت تراکنش (پرداخت تأیید شد) ---
        
        // 1. تولید لینک اشتراک و اطلاعات
        const refId = data.ref_id;
        const trackingId = `${isRenewal ? 'R-' : 'P-'}${refId}`;
        const userLink = `v2ray://${trackingId}`; // لینک اشتراک فرضی

        const purchaseDate = new Date().toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' });
        
        let planTitle = requestedPlan;
        let sheetTitle = isRenewal ? RENEW_SHEET_TITLE : planToSheetMap[originalAmount]; // عنوان شیت اصلی خرید/تمدید
        
        // اگر خرید عادی بود و قیمت آن در نقشه نبود (خطا)، از عنوان درخواستی استفاده می‌کنیم
        if (!sheetTitle) {
             sheetTitle = requestedPlan;
        }

        const planDescription = `${requestedPlan} (${usersCount} کاربره)`;


        // 2. ثبت اطلاعات در Google Sheet
        try {
            const doc = await getDoc();
            const sheet = doc.sheetsByTitle[sheetTitle];
            
            if (!sheet) {
                // اگر شیت مورد نظر پیدا نشد، خطا می‌زنیم
                throw new Error(`Sheet for plan ${sheetTitle} not found in the Google Sheet.`);
            }

            // اطمینان از بارگیری هدرهای صحیح
            await sheet.loadHeaderRow(1); 
            
            // تعیین تعداد روزهای اعتبار (برای نمایش در شیت)
            let expiryDays = planDurationDaysMap[sheetTitle] || 0;
            
            // اطلاعات سطر جدید
            const newRow = {
                'refId': refId,
                'trackingId': trackingId,
                'purchaseDate': purchaseDate,
                'amountPaid': expectedFinalAmount,
                'plan': planTitle,
                'users': usersCount.toString(),
                'expiryDays': expiryDays.toString(),
                'coupenCode': finalCoupenCode || 'N/A',
                'discountValue': originalAmount - expectedFinalAmount, // تفاوت مبلغ اصلی و نهایی
                'name': name || 'N/A',
                'email': email || 'N/A',
                'phone': phone || 'N/A',
                'chat_id': chat_id,
                'link': userLink
            };

            await sheet.addRow(newRow);
            
            // 3. کاهش موجودی کوپن (اگر استفاده شده باشد)
            if (couponInfo && couponInfo.row) {
                const updatedTimes = couponInfo.manyTimes - 1;
                couponInfo.row.set('manyTimes', updatedTimes);
                await couponInfo.row.save();
            }

            // 4. ارسال پیام موفقیت به ربات تلگرام
            const successMessage = `✅ *خرید موفق!*\n\nپلن: ${planDescription}\nمبلغ پرداختی: ${expectedFinalAmount / 10} تومان\nکد پیگیری: \`${trackingId}\`\nلینک اشتراک شما: \`${userLink}\`\n\nلطفاً لینک را در برنامه خود کپی کنید.`;
            if (chat_id && chat_id !== 'none') {
                bot.sendMessage(chat_id, successMessage, { parse_mode: 'Markdown' });
            }

            // 5. ارسال اعلان به ادمین
            const adminMessage = `🔔 *خرید جدید* (${isRenewal ? 'تمدید' : 'خرید عادی'})\n\nپلن: ${planDescription}\nمبلغ: ${expectedFinalAmount / 10} تومان\nکوپن: ${finalCoupenCode || 'ندارد'}\nکد پیگیری: ${trackingId}\nلینک: ${userLink}`;
            bot.sendMessage(ADMIN_CHAT_ID, adminMessage, { parse_mode: 'Markdown' });

        } catch (error) {
            console.error('Google Sheet/Server Error:', error.message);
            // در صورت بروز خطا در ثبت شیت، صرفاً به کاربر لینک را نمایش داده و به ادمین هشدار می‌دهیم.
            bot.sendMessage(ADMIN_CHAT_ID, `⚠️ *خطای ثبت سفارش!*\n\nسفارش با موفقیت پرداخت شد (RefID: ${refId}) اما در ثبت اطلاعات در شیت، خطا رخ داد.\nپلن: ${planTitle}\nلینک: ${userLink}\n\nخطا: ${error.message}`, { parse_mode: 'Markdown' });
        }
        
        // 6. نمایش صفحه موفقیت به کاربر
        displaySuccessPage(res, userLink, planDescription, trackingId);

    } catch (error) {
        console.error('Fatal Verification Error:', error.message);
        // خطای کلی در فرآیند تأیید یا ارتباط با زرین‌پال
        displayErrorPage(res, 'خطای سرور', 'خطای داخلی در فرآیند تأیید پرداخت رخ داده است. لطفاً با پشتیبانی تماس بگیرید.');
    }
};
