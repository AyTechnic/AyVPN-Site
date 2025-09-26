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
const ADMIN_CHAT_ID = '5976170456'; // آیدی عددی شما که فرستادید

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

const planToSheetMap = {
    '120000': '30D', '220000': '60D', '340000': '90D',
    '600000': '180D', '1000000': '365D', '2000000': '730D',
};

module.exports = async (req, res) => {
    // chat_id را از آدرس بازگشتی می‌خوانیم
    const { Authority, Status, chat_id } = req.query;

    try {
        if (Status !== 'OK') {
            await bot.sendMessage(chat_id, '❌ پرداخت شما ناموفق بود یا توسط شما لغو شد.');
            return res.send('Payment was cancelled. Message sent to user.');
        }

        const amountResponse = await fetch(`https://api.zarinpal.com/pg/v4/payment/unverified.json`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ merchant_id: ZARINPAL_MERCHANT_ID, authority: Authority })
        });
        const amountResult = await amountResponse.json();
        const amount = amountResult.data.transactions[0].amount;

        const verificationResponse = await fetch(`https://api.zarinpal.com/pg/v4/payment/verify.json`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ merchant_id: ZARINPAL_MERCHANT_ID, authority: Authority, amount: amount })
        });
        const result = await verificationResponse.json();
        const { data } = result;

        if (result.errors.length === 0 && (data.code === 100 || data.code === 101)) {
            const sheetName = planToSheetMap[amount.toString()];
            if (!sheetName) throw new Error(`پلنی برای مبلغ ${amount} تومان یافت نشد.`);

            const serviceAccountAuth = new JWT({
                email: GOOGLE_SERVICE_ACCOUNT_EMAIL, key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
            const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);

            await doc.loadInfo();
            const sheet = doc.sheetsByTitle[sheetName];
            if (!sheet) throw new Error(`شیت با نام "${sheetName}" یافت نشد.`);
            
            const rows = await sheet.getRows();
            const availableLinkRow = rows.find(row => row.get('status') === 'unused');
            if (!availableLinkRow) {
                 await bot.sendMessage(chat_id, '❌ پرداخت شما موفق بود اما متاسفانه تمام لینک‌های اشتراک این پلن تمام شده است. لطفاً با پشتیبانی (@AyVPNsupport) تماس بگیرید.');
                 throw new Error('No unused links available.');
            }

            const userLink = availableLinkRow.get('link');
            availableLinkRow.set('status', 'used-telegram-' + new Date().toISOString());
            await availableLinkRow.save();

            // --- ارسال پیام موفقیت به کاربر و ادمین ---
            await bot.sendMessage(chat_id, `✅ پرداخت شما با موفقیت انجام شد!\n\n🔗 لینک اشتراک شما:\n\`${userLink}\`\n\n🙏 از خرید شما سپاسگزاریم.`, { parse_mode: 'Markdown' });
            await bot.sendMessage(ADMIN_CHAT_ID, `🎉 فروش جدید! 🎉\n\nیک اشتراک ${sheetName} به مبلغ ${amount} تومان فروخته شد.`);
            
            // کاربر را به ربات هدایت می‌کنیم
            return res.redirect(`https://t.me/aylinvpnbot`);
        
        } else {
             throw new Error(`تایید پرداخت با زرین‌پال ناموفق بود. کد خطا: ${data.code || result.errors.code}`);
        }
    } catch (error) {
        console.error('Vercel Function Error:', error.message);
        if(chat_id) {
             await bot.sendMessage(chat_id, 'เกิดข้อผิดพลาดในการประมวลผลการชำระเงินของคุณ กรุณาติดต่อฝ่ายสนับสนุน @AyVPNsupport');
        }
        // یک پاسخ ساده به زرین‌پال می‌دهیم
        return res.status(200).send('An error occurred but was handled.');
    }
};
