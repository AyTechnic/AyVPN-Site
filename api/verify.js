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
const ADMIN_CHAT_ID = '5976170456'; // لطفا این را با شناسه چت ادمین واقعی خود جایگزین کنید.

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

// [حذف planToSheetMap قدیمی که بر اساس قیمت بود و دیگر قابل استفاده نیست]
// const planToSheetMap = { ... }; 

// NEW: لیست ثابت نام شیت‌های پلن برای تطبیق با requestedPlan
const PLAN_SHEETS = ['30D', '60D', '90D', '180D', '365D', '730D'];
const RENEW_SHEET_TITLE = 'Renew'; 
const COUPON_SHEET_TITLE = 'Coupen';

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

// تابع کمکی برای پیدا کردن سطر کوپن
async function getCouponRow(doc, coupenCode) {
    if (!coupenCode) return null;
    try {
        const couponSheet = doc.sheetsByTitle[COUPON_SHEET_TITLE];
        if (!couponSheet) {
            console.error(`Coupon sheet titled '${COUPON_SHEET_TITLE}' not found.`);
            return null;
        }
        await couponSheet.loadHeaderRow(1);
        const rows = await couponSheet.getRows();
        return rows.find(row => row.get('coupen') === coupenCode);
    } catch (error) {
        console.error('Error fetching coupon row:', error.message);
        return null;
    }
}

// تابع تولید لینک و شناسه
async function generateTrackingIdAndLink(isRenew, isTelegram, name, phone) {
    // [NOTE: This is a placeholder for your actual V2Ray link generation logic]
    const trackingId = 'AY-' + Math.random().toString(36).substring(2, 9).toUpperCase();
    const userLink = `https://your.v2ray.link/${trackingId}`; 
    return { trackingId, userLink };
}

// --- توابع پاسخ دهی (HTML/CSS/JS کامل و طولانی) ---

function sendSuccessResponse(res, trackingId, userLink, chat_id, isTelegram, amount, requestedPlan, users, name, email) {
    const planName = requestedPlan === RENEW_SHEET_TITLE ? 'تمدید' : `${requestedPlan} (پلن)`;
    
    // شروع HTML بسیار طولانی (با حفظ محتوای اصلی شما)
    const htmlResponse = `
        <!DOCTYPE html>
        <html lang="fa" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>پرداخت موفق</title>
            <style>
                @font-face { font-family: 'Vazirmatn'; src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Bold.woff2') format('woff2'); font-weight: 700; font-display: swap; }
                @font-face { font-family: 'Vazirmatn'; src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Medium.woff2') format('woff2'); font-weight: 500; font-display: swap; }
                body { font-family: 'Vazirmatn', sans-serif; background-color: #f8f9fa; color: #212529; line-height: 1.6; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
                .container { background: #ffffff; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1); max-width: 600px; width: 90%; text-align: center; }
                h1 { color: #28a745; font-size: 2rem; margin-bottom: 15px; }
                .icon { font-size: 4rem; color: #28a745; margin-bottom: 20px; }
                p { margin-bottom: 15px; font-size: 1.1rem; }
                .subscription-box { background: #f1f1f1; padding: 15px; border-radius: 8px; margin: 20px 0; display: flex; flex-direction: column; align-items: center; }
                .subscription-link { display: block; margin-bottom: 15px; word-break: break-all; font-size: 0.9rem; direction: ltr; text-align: left; background: #fff; padding: 10px; border-radius: 5px; width: 100%; box-sizing: border-box; }
                .actions { display: flex; justify-content: center; gap: 10px; }
                button { background: #28a745; color: #fff; border: none; padding: 8px 15px; border-radius: 5px; cursor: pointer; font-family: 'Vazirmatn', sans-serif; transition: background-color 0.3s; display: flex; align-items: center; gap: 5px; }
                button:hover { background-color: #1e7e34; }
                button svg { width: 18px; height: 18px; fill: currentColor; }
                .info-box { background: #e9f7ef; padding: 15px; border-radius: 8px; margin-top: 15px; text-align: right; }
                .info-box strong { display: block; margin-bottom: 5px; }
            </style>
            <script>
                document.addEventListener('DOMContentLoaded', () => {
                    const subLink = document.getElementById('subLink');
                    const copyBtn = document.getElementById('copyBtn');
                    const openBtn = document.getElementById('openBtn');

                    if (copyBtn) {
                        copyBtn.onclick = () => {
                            navigator.clipboard.writeText(subLink.textContent);
                            copyBtn.title = 'کپی شد!';
                            setTimeout(() => copyBtn.title = 'کپی لینک', 2000);
                        };
                    }
                    if (openBtn) {
                        openBtn.onclick = () => window.open(subLink.textContent, '_blank');
                    }
                });
            </script>
        </head>
        <body>
            <div class="container">
                <div class="icon">✅</div>
                <h1>پرداخت موفق</h1>
                <p>خرید/تمدید شما با موفقیت انجام شد.</p>
                
                <div class="info-box">
                    <p><strong>مبلغ پرداختی:</strong> ${amount.toLocaleString('fa-IR')} تومان</p>
                    <p><strong>پلن درخواستی:</strong> ${planName} (${users} کاربر)</p>
                    <p><strong>شناسه پیگیری شما:</strong> ${trackingId}</p>
                </div>

                <div class="subscription-box">
                    <code class="subscription-link" id="subLink">${userLink}</code>
                    <div class="actions">
                        <button id="copyBtn" title="کپی لینک">
                            <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"></path></svg>
                            <span>کپی</span>
                        </button>
                        <button id="openBtn" title="باز کردن لینک">
                            <svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h11c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"></path></svg>
                            <span>باز کردن</span>
                        </button>
                    </div>
                </div>
                <p>لینک اشتراک همچنین به ربات تلگرام شما ارسال شد.</p>
            </div>
        </body>
        </html>
    `;
    
    res.status(200).send(htmlResponse);

    // ارسال لینک به تلگرام
    if (isTelegram && chat_id) {
        bot.sendMessage(chat_id, 
            `✅ **پرداخت موفق!**\n\n` + 
            `پلن: ${planName} (${users} کاربر)\n` + 
            `مبلغ: ${amount.toLocaleString('fa-IR')} تومان\n` +
            `شناسه پیگیری: \`${trackingId}\`\n\n` + 
            `لینک اشتراک جدید/تمدید شده شما:\n\`${userLink}\``, 
            { parse_mode: 'Markdown' }
        );
        // ارسال نوتیفیکیشن ادمین
        bot.sendMessage(ADMIN_CHAT_ID, 
            `🚨 **خرید جدید (وب/تلگرام)**\n` + 
            `ش: \`${trackingId}\`\n` + 
            `مبلغ: ${amount.toLocaleString('fa-IR')} تومان\n` + 
            `پلن: ${requestedPlan} (${users} کاربر)\n` +
            `نام: ${name || 'N/A'}\n` +
            `ایمیل: ${email || 'N/A'}`,
            { parse_mode: 'Markdown' }
        );
    }
}

function sendErrorResponse(res, errorMessage, chat_id, isTelegram) {
    // شروع HTML بسیار طولانی برای خطا (با حفظ محتوای اصلی شما)
    const htmlResponse = `
        <!DOCTYPE html>
        <html lang="fa" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>خطا در انجام عملیات</title>
            <style>
                @font-face { font-family: 'Vazirmatn'; src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Bold.woff2') format('woff2'); font-weight: 700; font-display: swap; }
                @font-face { font-family: 'Vazirmatn'; src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Medium.woff2') format('woff2'); font-weight: 500; font-display: swap; }
                body { font-family: 'Vazirmatn', sans-serif; background-color: #f8f9fa; color: #212529; line-height: 1.6; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
                .container { background: #ffffff; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1); max-width: 600px; width: 90%; text-align: center; }
                h1 { color: #dc3545; font-size: 2rem; margin-bottom: 15px; }
                .icon { font-size: 4rem; color: #dc3545; margin-bottom: 20px; }
                p { margin-bottom: 15px; font-size: 1.1rem; }
                .info-box { background: #fbecec; padding: 15px; border-radius: 8px; margin-top: 15px; text-align: right; }
                .info-box strong { display: block; margin-bottom: 5px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="icon">❌</div>
                <h1>خطا در انجام عملیات</h1>
                <p>${errorMessage}</p>
                <p>لطفاً در صورت کسر وجه با ادمین در تماس باشید.</p>
                <div class="info-box">
                    <p>در صورتی که وجه از حساب شما کسر شده است، ظرف ۲۴ الی ۷۲ ساعت به صورت خودکار به حساب شما بازگردانده خواهد شد.</p>
                    <p>اگر وجه بازگردانده نشد، لطفاً از طریق ربات تلگرام یا ایمیل با شناسه پیگیری خود با ادمین در تماس باشید.</p>
                </div>
            </div>
        </body>
        </html>
    `;
    
    res.status(400).send(htmlResponse);
    
    // ارسال خطا به تلگرام
    if (isTelegram && chat_id) {
        bot.sendMessage(chat_id, `❌ متأسفانه در فرایند پرداخت یا ثبت سفارش شما خطایی رخ داده است. \n\n جزئیات خطا: ${errorMessage}`, { parse_mode: 'Markdown' });
    }
}


// --- تابع اصلی: تأیید پرداخت ---
module.exports = async (req, res) => {
    try {
        const doc = await getOrCreateDoc();
        
        // ۱. دریافت پارامترهای بازگشتی
        const { 
            amount, authority, status, 
            chat_id, name, email, phone, 
            renewalIdentifier, requestedPlan, 
            coupenCode, users, 
            telegramUsername, telegramId // ...
        } = req.query; 

        const isTelegram = chat_id !== 'none' && chat_id;
        const finalAmount = parseInt(amount); 

        // ۲. بررسی وضعیت بازگشتی از زرین‌پال
        if (!authority || status !== 'OK') {
            return sendErrorResponse(res, 'تأیید پرداخت موفقیت آمیز نبود یا توسط شما لغو شده است.', chat_id, isTelegram);
        }
        
        // ۳. درخواست تأیید نهایی از زرین‌پال
        const verificationResponse = await fetch('https://api.zarinpal.com/pg/v4/payment/verify.json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                merchant_id: ZARINPAL_MERCHANT_ID,
                amount: finalAmount, 
                authority: authority,
            }),
        });
        const verificationResult = await verificationResponse.json();

        // ۴. بررسی نتیجه تأیید
        if (verificationResult.data && verificationResult.data.code === 100) {
            
            // --- A. منطق جدید برای یافتن شیت مقصد بر اساس requestedPlan (FIXED) ---
            let sheetTitle;
            if (requestedPlan === RENEW_SHEET_TITLE) {
                sheetTitle = RENEW_SHEET_TITLE; // 'Renew'
            } else if (PLAN_SHEETS.includes(requestedPlan)) {
                sheetTitle = requestedPlan; // e.g., '30D'
            } else {
                const errorMessage = `خطا: کد پلن درخواستی نامعتبر است: ${requestedPlan}.`;
                console.error(errorMessage);
                return sendErrorResponse(res, errorMessage, chat_id, isTelegram);
            }
            
            const isRenew = sheetTitle === RENEW_SHEET_TITLE;
            const sheet = doc.sheetsByTitle[sheetTitle];
            
            if (!sheet) {
                const errorMessage = `خطا: شیت با نام '${sheetTitle}' در گوگل شیت یافت نشد. لطفاً به ادمین اطلاع دهید.`;
                console.error(errorMessage);
                return sendErrorResponse(res, errorMessage, chat_id, isTelegram);
            }
            
            // --- B. به‌روزرسانی وضعیت کوپن (FIXED) ---
            if (coupenCode) {
                const couponRow = await getCouponRow(doc, coupenCode);
                
                if (couponRow) {
                    // به‌روزرسانی محدودیت استفاده (manyTimes)
                    let manyTimes = couponRow.get('manyTimes');
                    if (manyTimes && manyTimes.toString().toLowerCase() !== 'unlimited') {
                        let count = parseInt(manyTimes);
                        if (!isNaN(count) && count > 0) {
                            couponRow.set('manyTimes', count - 1);
                            await couponRow.save(); // **نکته حیاتی: ذخیره تغییرات کوپن**
                        }
                    }
                }
            }

            // --- C. ثبت اطلاعات خرید ---
            const { trackingId, userLink } = await generateTrackingIdAndLink(isRenew, isTelegram, name, phone);
            const now = new Date();
            const purchaseDate = now.toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' });

            await sheet.loadHeaderRow(1); 
            
            // ساخت شیء سطر جدید برای افزودن
            const newRow = {
                status: 'فعال',
                link: userLink,
                trackingId: trackingId,
                purchaseDate: purchaseDate,
                name: name || 'N/A',
                email: email || 'N/A',
                chat_id: chat_id || 'N/A',
                phone: phone || 'N/A',
                coupen: coupenCode || '',
                users: users || '1', 
                renewalCount: isRenew ? 'N/A' : '0', 
                lastRenewalDate: isRenew ? purchaseDate : 'N/A',
                
                // فیلدهای شیت Renew 
                ...(isRenew ? {
                    renewalIdentifier: renewalIdentifier || '',
                    requestedPlan: requestedPlan || '',
                    telegramUsername: telegramUsername || '',
                    telegramId: telegramId || '',
                    requestDate: purchaseDate, 
                    amount: amount, 
                } : {})
            };

            await sheet.addRow(newRow);
            
            sendSuccessResponse(res, trackingId, userLink, chat_id, isTelegram, finalAmount, requestedPlan, users, name, email);

        } else {
            // پرداخت موفقیت آمیز نبود اما از درگاه برگشته است
            const errorMessage = `خطا در تأیید پرداخت نهایی از زرین‌پال (کد خطا: ${verificationResult.data.code}).`;
            sendErrorResponse(res, errorMessage, chat_id, isTelegram);
        }

    } catch (error) {
        console.error('Critical Error in Verify:', error.message);
        sendErrorResponse(res, `خطای داخلی سرور در فرایند تأیید: ${error.message}`, req.query.chat_id, req.query.chat_id !== 'none');
    }
};
