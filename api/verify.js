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

// تابع ساخت صفحه HTML موفقیت (برای وب)
function generateSuccessPage(details) { /* ... محتوای این تابع مانند قبل است ... */ }

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

            // --- منطق جدید برای تمدید اشتراک ---
            if (renewalIdentifier && renewalIdentifier !== '') {
                const renewSheet = doc.sheetsByTitle['Renew'];
                if (!renewSheet) throw new Error('شیت "Renew" یافت نشد.');

                await renewSheet.addRow({
                    renewalIdentifier: renewalIdentifier,
                    requestedPlan: requestedPlan,
                    telegramUsername: name, // name from query is username
                    telegramId: email,     // email from query is user ID
                    requestDate: new Date().toISOString()
                });

                await bot.sendMessage(chat_id, '✅ درخواست تمدید اشتراک شما با موفقیت ثبت شد.\nدر ساعات آینده پیام تکمیل فرآیند به اطلاع شما خواهد رسید.');
                await bot.sendMessage(ADMIN_CHAT_ID, `
 renewalIdentifier: ${renewalIdentifier}
 requestedPlan: ${requestedPlan}
 telegramUsername: @${name}
 telegramId: ${email}
                `);

                return res.redirect(`https://t.me/aylinvpnbot`);
            }

            // --- منطق خرید اشتراک جدید ---
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
                await bot.sendMessage(ADMIN_CHAT_ID, `
🎉 **فروش جدید از ربات!** 🎉

**کاربر:** ${name} ([@${phone || 'N/A'}](tg://user?id=${email}))
**پلن:** ${sheetName} (${amount} تومان)
**لینک فروخته شده:** \`${userLink}\`
**شماره پیگیری:** \`${trackingId}\`
                `, { parse_mode: 'Markdown' });

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

async function findPreviousPurchases(doc, email, phone) { /* ... محتوای این تابع مانند قبل است ... */ }
