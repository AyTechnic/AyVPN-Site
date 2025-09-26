const { GoogleSpreadsheet } = require('google-spreadsheet');
const axios = require('axios');

const ZARINPAL_MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'); 

const planToSheetMap = {
    '12000': '30D', '220000': '60D', '340000': '90D',
    '600000': '180D', '10000': '365D', '2000000': '730D',
};

function generateResponseMessage(title, message, type = 'success', link = null) {
    // ... (این تابع بدون تغییر باقی می‌ماند)
}

module.exports = async (req, res) => {
    const { Authority, Status } = req.query;

    if (Status !== 'OK') {
        return res.status(400).send(generateResponseMessage('پرداخت ناموفق', 'پرداخت توسط شما لغو شد.', 'error'));
    }

    try {
        // --- استعلام مبلغ اینجا حذف شد چون در API جدید نیازی نیست ---
        
        // --- درخواست تاییدیه به آدرس جدید API ارسال می‌شود ---
        const verificationResponse = await axios.post(`https://www.zarinpal.com/pg/rest/WebGate/PaymentVerification.json`, {
            MerchantID: ZARINPAL_MERCHANT_ID,
            Authority: Authority,
            // در این نسخه از API، مبلغ باید از جایی دیگر بیاید. ما آن را دوباره استعلام می‌کنیم.
            // بیایید یک استعلام مبلغ اضافه کنیم
        });
        
        // **اصلاح مهم:** API جدید نیاز به مبلغ دارد. باید آن را از جایی به دست آوریم.
        // اجازه دهید کد را اصلاح کنم تا با این API جدید هماهنگ شود.
        
        // ابتدا باید مبلغ را بدانیم. این یک ضعف در این API است.
        // راه حل: ما باید پس از بازگشت کاربر، مجددا از زرین‌پال بپرسیم مبلغ چقدر بوده.
        // متاسفانه API REST زرین‌پال تابعی برای این کار ندارد. این یک بن‌بست فنی از سمت زرین‌پال است.
        
        // **بیایید به API قبلی (v4) برگردیم و یک تغییر کوچک دیگر را امتحان کنیم.**
        // مشکل 404 ممکن است به خاطر user-agent باشد.
        
        // **کد نهایی و اصلاح شده verify.js (بازگشت به API v4 با هدرهای کامل)**
        const unverifiedResponse = await axios.post('https://api.zarinpal.com/pg/v4/payment/unverified.json', 
            { merchant_id: ZARINPAL_MERCHANT_ID, authority: Authority },
            { headers: { 'User-Agent': 'axios/0.21.1', 'Content-Type': 'application/json' } }
        );

        const amount = unverifiedResponse.data.data.transactions[0].amount;

        const verificationResponse = await axios.post('https://api.zarinpal.com/pg/v4/payment/verify.json', 
            { merchant_id: ZARINPAL_MERCHANT_ID, authority: Authority, amount: amount },
            { headers: { 'User-Agent': 'axios/0.21.1', 'Content-Type': 'application/json' } }
        );

        const { data } = verificationResponse.data;

        if (data.code === 100 || data.code === 101) {
            const sheetName = planToSheetMap[amount.toString()];
            if (!sheetName) throw new Error(`پلنی برای مبلغ ${amount} تومان یافت نشد.`);

            const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID);
            await doc.useServiceAccountAuth({ client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: GOOGLE_PRIVATE_KEY, });

            await doc.loadInfo();
            const sheet = doc.sheetsByTitle[sheetName];
            if (!sheet) throw new Error(`شیت با نام "${sheetName}" یافت نشد.`);
            
            const rows = await sheet.getRows();
            const availableLinkRow = rows.find(row => row.get('status') === 'unused');

            if (!availableLinkRow) {
                return res.status(500).send(generateResponseMessage('پرداخت موفق، تحویل ناموفق', `متاسفانه لینک‌های اشتراک تمام شده است. کد پیگیری: ${data.ref_id}`, 'error'));
            }

            const userLink = availableLinkRow.get('link');
            availableLinkRow.set('status', 'used-' + new Date().toISOString());
            await availableLinkRow.save();

            res.status(200).send(generateResponseMessage('پرداخت موفقیت آمیز بود!', `لینک اشتراک شما آماده است. کد پیگیری: ${data.ref_id}`, 'success', userLink));
        
        } else {
            throw new Error(`تایید پرداخت ناموفق بود. کد خطا: ${data.code}`);
        }
    } catch (error) {
        console.error('Vercel Function Error:', error.message);
        res.status(500).send(generateResponseMessage('خطای سرور', `در پردازش تراکنش خطایی رخ داد. جزئیات خطا: ${error.message}`, 'error'));
    }
};
