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

const planToSheetMap = {
    '12000': '30D', '220000': '60D', '340000': '90D',
    '600000': '180D', '10000': '365D', '2000000': '730D',
};

// --- توابع ساخت صفحه HTML (بدون تغییر) ---
function generateSuccessPage({ trackingId, userLink, previousPurchases, name }) { /* ... محتوای تابع مانند قبل ... */ }
function generateRenewalSuccessPage({ message, name }) { /* ... محتوای تابع مانند قبل ... */ }

module.exports = async (req, res) => {
    const { Authority, Status, amount, chat_id, name, email, phone, renewalIdentifier, requestedPlan } = req.query;

    try {
        if (Status !== 'OK') throw new Error('Payment was cancelled by user.');

        const verificationResponse = await fetch(`https://api.zarinpal.com/pg/v4/payment/verify.json`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ merchant_id: ZARINPAL_MERCHANT_ID, authority: Authority, amount: Number(amount) })
        });
        const result = await verificationResponse.json();
        const { data } = result;

        if (result.errors.length === 0 && (data.code === 100 || data.code === 101)) {
            const serviceAccountAuth = new JWT({
                email: GOOGLE_SERVICE_ACCOUNT_EMAIL, key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
            const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);
            await doc.loadInfo();

            // --- منطق تمدید اشتراک (اصلاح شده و کاملا هماهنگ) ---
            if (renewalIdentifier && renewalIdentifier !== '') {
                const renewSheet = doc.sheetsByTitle['Renew'];
                if (!renewSheet) throw new Error('شیت "Renew" یافت نشد.');

                // *** بخش اصلاح شده اینجاست ***
                // حالا هر داده در ستون مخصوص به خودش ذخیره می‌شود
                const newRowData = {
                    renewalIdentifier: renewalIdentifier,
                    requestedPlan: requestedPlan,
                    name: name || '', // نام واقعی کاربر اگر وارد کرده باشد
                    email: email || '', // ایمیل واقعی کاربر اگر وارد کرده باشد
                    phone: phone || '', // تلفن واقعی کاربر اگر وارد کرده باشد
                    requestDate: new Date().toISOString()
                };
                
                // اگر درخواست از ربات باشد، اطلاعات تلگرامی را هم اضافه می‌کنیم
                if (chat_id && chat_id !== 'none') {
                    newRowData.telegramUsername = phone; // در ربات، یوزرنیم در متغیر phone ذخیره می‌شود
                    newRowData.telegramId = email;       // در ربات، آیدی در متغیر email ذخیره می‌شود
                }

                await renewSheet.addRow(newRowData);
                // *** پایان بخش اصلاح شده ***

                const adminMessage = `
🔄 **درخواست تمدید جدید (${chat_id === 'none' || !chat_id ? 'وبسایت' : 'ربات'})** 🔄

شناسه تمدید: ${renewalIdentifier}
پلن درخواستی: ${requestedPlan}
نام کاربر: ${name || 'N/A'}
ایمیل/شناسه: ${email || 'N/A'}
تلفن/یوزرنیم: ${phone || 'N/A'}
                `;
                await bot.sendMessage(ADMIN_CHAT_ID, adminMessage.trim());

                if (chat_id && chat_id !== 'none') {
                    await bot.sendMessage(chat_id, '✅ درخواست تمدید اشتراک شما با موفقیت ثبت شد.\nدر ساعات آینده پیام تکمیل فرآیند به اطلاع شما خواهد رسید.');
                    return res.redirect(`https://t.me/aylinvpnbot`);
                } else {
                    const successMessage = '✅ درخواست تمدید اشتراک شما با موفقیت ثبت شد.\nدر ساعات آینده پیام تکمیل فرآیند به اطلاع شما خواهد رسید.';
                    return res.status(200).send(generateRenewalSuccessPage({ message: successMessage, name }));
                }
            }

            // --- منطق خرید اشتراک جدید (بدون تغییر) ---
            const sheetName = planToSheetMap[amount.toString()];
            if (!sheetName) throw new Error(`پلنی برای مبلغ ${amount} تومان یافت نشد.`);
            
            const sheet = doc.sheetsByTitle[sheetName];
            if (!sheet) throw new Error(`شیت با نام "${sheetName}" یافت نشد.`);
            
            const rows = await sheet.getRows();
            const availableLinkRow = rows.find(row => row.get('status') === 'unused');
            if (!availableLinkRow) {
                if (chat_id && chat_id !== 'none') {
                    await bot.sendMessage(chat_id, '❌ پرداخت موفق بود اما تمام لینک‌های این پلن تمام شده است. لطفاً با پشتیبانی (@AyVPNsupport) تماس بگیرید.');
                }
                throw new Error('No unused links available.');
            }
            
            const userLink = availableLinkRow.get('link');
            const trackingId = data.ref_id.toString();

            availableLinkRow.set('status', 'used');
            availableLinkRow.set('trackingId', trackingId);
            availableLinkRow.set('purchaseDate', new Date().toISOString());
            if(name) availableLinkRow.set('name', name);
            if(email) availableLinkRow.set('email', email);
            if(phone) availableLinkRow.set('phone', phone);
            await availableLinkRow.save();

            if (chat_id && chat_id !== 'none') {
                 // ... بقیه کد بدون تغییر
            } else {
                 // ... بقیه کد بدون تغییر
            }
        
        } else {
            throw new Error(`تایید پرداخت ناموفق بود. کد خطا: ${data.code || result.errors.code}`);
        }
    } catch (error) {
        console.error('Vercel Function Error:', error.message);
        if (chat_id && chat_id !== 'none') {
            await bot.sendMessage(chat_id, '❌ در پردازش پرداخت شما خطایی رخ داد. لطفاً با پشتیبانی (@AyVPNsupport) تماس بگیرید.');
        }
        return res.status(500).send(`<h1>خطا در سرور</h1><p>${error.message}</p>`);
    }
};

// توابعی که در بالا خلاصه شده‌اند را اینجا کامل قرار دهید
function generateSuccessPage({ trackingId, userLink, previousPurchases, name }) {
    let purchasesHtml = previousPurchases.map(p => `<li><strong>${p.plan}:</strong> <a href="${p.link}" target="_blank">مشاهده لینک</a> (تاریخ: ${new Date(p.date).toLocaleDateString('fa-IR')})</li>`).join('');
    return `
        <!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>پرداخت موفق</title><style>body{font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f0f2f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0;}.container{width: 100%; max-width: 500px; padding: 20px;}.card{background: #fff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; padding: 40px 30px;}.icon-success{width: 70px; height: 70px; background-color: #28a745; color: white; border-radius: 50%; display: inline-flex; justify-content: center; align-items: center; font-size: 3rem; margin-bottom: 20px; line-height: 70px;}h1{margin: 0 0 15px; font-size: 1.8rem; color: #333;}p{color: #666; font-size: 1.1rem; line-height: 1.6;}.details{background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 20px; margin: 25px 0; word-break: break-all;}.details .link{font-size: 1.2rem; font-weight: bold; color: #007bff; display: block; margin-bottom: 10px;}.details .tracking{font-size: 1rem; color: #555;}.footer-note{margin-top: 25px; font-size: 0.9rem; color: #888;}</style></head><body><div class="container"><div class="card"><div class="icon-success">✓</div><h1>پرداخت موفقیت‌آمیز بود</h1><p>کاربر گرامی ${name || ''}، از خرید شما سپاسگزاریم.</p><div class="details"><a class="link" href="${userLink}" target="_blank">${userLink}</a><p class="tracking">شماره پیگیری: <strong>${trackingId}</strong></p></div>${purchasesHtml.length > 0 ? `<h3>خریدهای پیشین شما:</h3><ul>${purchasesHtml}</ul>` : ''}<p class="footer-note">لطفاً لینک و شماره پیگیری را در جایی امن نگهداری کنید.<br>Ay Technic</p></div></div></body></html>`;
}

function generateRenewalSuccessPage({ message, name }) {
    return `
        <!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>وضعیت درخواست تمدید</title><style>body{font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f0f2f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0;}.container{width: 100%; max-width: 500px; padding: 20px;}.card{background: #fff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; padding: 40px 30px;}.icon-success{width: 70px; height: 70px; background-color: #007bff; color: white; border-radius: 50%; display: inline-flex; justify-content: center; align-items: center; font-size: 3rem; margin-bottom: 20px; line-height: 70px;}h1{margin: 0 0 15px; font-size: 1.8rem; color: #333;}p{color: #666; font-size: 1.1rem; line-height: 1.6;}.details{background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 20px; margin: 25px 0;}.footer-note{margin-top: 25px; font-size: 0.9rem; color: #888;}</style></head><body><div class="container"><div class="card"><div class="icon-success">✓</div><h1>درخواست ثبت شد</h1><p>کاربر گرامی ${name || ''}، درخواست شما با موفقیت در سیستم ثبت گردید.</p><div class="details"><p>${message.replace(/\n/g, '<br>')}</p></div><p class="footer-note">از انتخاب مجدد شما سپاسگزاریم!<br>Ay Technic</p></div></div></body></html>`;
}
