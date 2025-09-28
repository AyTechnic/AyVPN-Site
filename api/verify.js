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
    '1200': '30D', '220000': '60D', '340000': '90D',
    '600000': '180D', '1000': '365D', '2000000': '730D',
};

// --- توابع کمکی برای ساخت صفحات HTML ---

// نسخه نهایی صفحه موفقیت خرید با شمارش معکوس
function generateSuccessPage({ trackingId, userLink, previousPurchases, name }) {
    let purchasesHtml = previousPurchases.map(p => `<li><strong>${p.plan}:</strong> <a href="${p.link}" target="_blank">مشاهده لینک</a> (تاریخ: ${new Date(p.date).toLocaleDateString('fa-IR')})</li>`).join('');
    
    return `
        <!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>پرداخت موفق</title><style>body{font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f0f2f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0;}.container{width: 100%; max-width: 500px; padding: 20px;}.card{background: #fff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; padding: 40px 30px;}.icon-success{width: 70px; height: 70px; background-color: #28a745; color: white; border-radius: 50%; display: inline-flex; justify-content: center; align-items: center; font-size: 3rem; margin-bottom: 20px; line-height: 70px;}h1{margin: 0 0 15px; font-size: 1.8rem; color: #333;}p{color: #666; font-size: 1.1rem; line-height: 1.6;}.details{background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 20px; margin: 25px 0; word-break: break-all;}.details .link{font-size: 1.2rem; font-weight: bold; color: #007bff; display: block; margin-bottom: 10px;}.details .tracking{font-size: 1rem; color: #555;}.footer-note{margin-top: 25px; font-size: 0.9rem; color: #888;}#countdown-message{font-weight: bold; color: #333;}</style></head><body><div class="container"><div class="card"><div class="icon-success">✓</div><h1>پرداخت موفقیت‌آمیز بود</h1><p>کاربر گرامی ${name || ''}، از خرید شما سپاسگزاریم.</p><div class="details"><a class="link" id="subscription-link" href="${userLink}" target="_blank">${userLink}</a><p class="tracking">شماره پیگیری: <strong>${trackingId}</strong></p></div>${purchasesHtml.length > 0 ? `<h3>خریدهای پیشین شما:</h3><ul>${purchasesHtml}</ul>` : ''}<p id="countdown-message" class="footer-note"></p><p class="footer-note">لطفاً لینک و شماره پیگیری را در جایی امن نگهداری کنید.<br>Ay Technic</p></div></div><script>(function() { let seconds = 5; const countdownElement = document.getElementById('countdown-message'); const userLink = document.getElementById('subscription-link').href; function updateCountdown() { countdownElement.textContent = 'لینک اشتراک شما تا ' + seconds + ' ثانیه دیگر به صورت خودکار باز می‌شود...'; } updateCountdown(); const interval = setInterval(() => { seconds--; updateCountdown(); if (seconds <= 0) { clearInterval(interval); countdownElement.textContent = 'در حال باز کردن لینک...'; window.open(userLink, '_blank'); } }, 1000); })();</script></body></html>`;
}

// تابع جدید برای صفحه موفقیت تمدید
function generateRenewalSuccessPage({ message, name }) {
    return `
        <!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>وضعیت درخواست تمدید</title><style>body{font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f0f2f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0;}.container{width: 100%; max-width: 500px; padding: 20px;}.card{background: #fff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; padding: 40px 30px;}.icon-success{width: 70px; height: 70px; background-color: #007bff; color: white; border-radius: 50%; display: inline-flex; justify-content: center; align-items: center; font-size: 3rem; margin-bottom: 20px; line-height: 70px;}h1{margin: 0 0 15px; font-size: 1.8rem; color: #333;}p{color: #666; font-size: 1.1rem; line-height: 1.6;}.details{background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 20px; margin: 25px 0;}.footer-note{margin-top: 25px; font-size: 0.9rem; color: #888;}</style></head><body><div class="container"><div class="card"><div class="icon-success">✓</div><h1>درخواست ثبت شد</h1><p>کاربر گرامی ${name || ''}، درخواست شما با موفقیت در سیستم ثبت گردید.</p><div class="details"><p>${message.replace(/\n/g, '<br>')}</p></div><p class="footer-note">از انتخاب مجدد شما سپاسگزاریم!<br>Ay Technic</p></div></div></body></html>`;
}

// تابع بازسازی شده برای یافتن خریدهای قبلی
async function findPreviousPurchases(doc, email, phone) {
    const purchases = [];
    if (!email && !phone) return purchases;

    for (const sheet of doc.sheetsByIndex) {
        // از شیت‌های غیرمرتبط عبور کن
        if (sheet.title === 'Renew' || !Object.values(planToSheetMap).includes(sheet.title)) continue;
        
        try {
            const rows = await sheet.getRows();
            for (const row of rows) {
                const rowEmail = row.get('email');
                const rowPhone = row.get('phone');
                if ((email && rowEmail === email) || (phone && rowPhone === phone)) {
                    purchases.push({
                        plan: sheet.title,
                        date: row.get('purchaseDate'),
                        link: row.get('link')
                    });
                }
            }
        } catch (error) {
            console.error(`Error reading rows from sheet: ${sheet.title}`, error);
        }
    }
    return purchases;
}


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

            // --- بخش جدید: منطق تمدید اشتراک ---
            if (renewalIdentifier && renewalIdentifier !== '') {
                const renewSheet = doc.sheetsByTitle['Renew'];
                if (!renewSheet) throw new Error('شیت "Renew" یافت نشد.');

                const newRowData = {
                    renewalIdentifier: renewalIdentifier, requestedPlan: requestedPlan,
                    name: name || '', email: email || '', phone: phone || '',
                    requestDate: new Date().toISOString()
                };
                if (chat_id && chat_id !== 'none') {
                    newRowData.telegramUsername = phone;
                    newRowData.telegramId = email;
                }
                await renewSheet.addRow(newRowData);

                const adminMessage = `🔄 **درخواست تمدید جدید (${chat_id === 'none' || !chat_id ? 'وبسایت' : 'ربات'})** 🔄\n\nشناسه تمدید: ${renewalIdentifier}\nپلن درخواستی: ${requestedPlan}\nنام کاربر: ${name || 'N/A'}\nایمیل/شناسه: ${email || 'N/A'}\nتلفن/یوزرنیم: ${phone || 'N/A'}`;
                await bot.sendMessage(ADMIN_CHAT_ID, adminMessage.trim(), { parse_mode: 'Markdown' });

                if (chat_id && chat_id !== 'none') {
                    await bot.sendMessage(chat_id, '✅ درخواست تمدید اشتراک شما با موفقیت ثبت شد.\nدر ساعات آینده پیام تکمیل فرآیند به اطلاع شما خواهد رسید.');
                    return res.redirect(`https://t.me/aylinvpnbot`);
                } else {
                    const successMessage = '✅ درخواست تمدید اشتراک شما با موفقیت ثبت شد.\nدر ساعات آینده پیام تکمیل فرآیند به اطلاع شما خواهد رسید.';
                    return res.status(200).send(generateRenewalSuccessPage({ message: successMessage, name }));
                }
            }

            // --- منطق اصلی شما برای خرید اشتراک جدید (بدون تغییر) ---
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
                await bot.sendMessage(chat_id, `✅ پرداخت شما با موفقیت انجام شد!\n\n🔗 لینک اشتراک شما:\n\`${userLink}\`\n\n🔢 شماره پیگیری: \`${trackingId}\``, { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[{ text: '👁️ مشاهده اشتراک', url: userLink }]]
                    }
                });
                await bot.sendMessage(ADMIN_CHAT_ID, `🎉 **فروش جدید از ربات!** 🎉\n\n**کاربر:** ${name} ([@${phone || 'N/A'}](tg://user?id=${email}))\n**پلن:** ${sheetName} (${amount} تومان)\n**لینک فروخته شده:** \`${userLink}\`\n**شماره پیگیری:** \`${trackingId}\``, { parse_mode: 'Markdown' });

                return res.redirect(`https://t.me/aylinvpnbot`);
            } else {
                const previousPurchases = await findPreviousPurchases(doc, email, phone);
                return res.status(200).send(generateSuccessPage({ trackingId, userLink, previousPurchases, name }));
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