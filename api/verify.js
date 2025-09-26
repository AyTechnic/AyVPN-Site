const { GoogleSpreadsheet } = require('google-spreadsheet');
const axios = require('axios');

// --- اطلاعات حساس شما از Environment Variables خوانده می‌شود ---
const ZARINPAL_MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'); 

// --- نقشه مبالغ به نام شیت‌ها ---
const planToSheetMap = {
    '12000':  '30D', '22000':  '60D', '34000':  '90D',
    '60000':  '180D', '10000': '365D', '20000': '730D',
};

// تابع کمکی برای ساخت صفحه پاسخ به کاربر
function generateResponseMessage(title, message, type = 'success', link = null) {
    const colors = {
        success: { bg: '#e8f5e9', text: '#2e7d32', icon: '✔' },
        error: { bg: '#ffebee', text: '#c62828', icon: '✖' }
    };
    const color = colors[type];
    return `
        <html lang="fa"><head><meta charset="UTF-8"><title>${title}</title><style>
            body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background-color: #f4f4f5; direction: rtl; }
            .container { background-color: white; padding: 40px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); text-align: center; max-width: 500px; width: 90%; border-top: 5px solid ${color.text}; }
            .icon { font-size: 3rem; color: ${color.text}; } h1 { color: #333; font-size: 1.5rem; margin-top: 20px; } p { color: #555; font-size: 1rem; }
            .link-box { background: #f0f0f0; padding: 15px; border-radius: 8px; font-size: 1.1em; direction: ltr; margin-top: 25px; border: 1px dashed #ccc; word-wrap: break-word; text-align: left; }
        </style></head><body>
        <div class="container">
            <div class="icon">${color.icon}</div><h1>${title}</h1><p>${message}</p>
            ${link ? `<p style="margin-top:20px; font-weight: bold;">لینک اشتراک شما:</p><div class="link-box">${link}</div>` : ''}
        </div></body></html>`;
}

module.exports = async (req, res) => {
    const { Authority, Status } = req.query;

    if (Status !== 'OK') {
        return res.status(400).send(generateResponseMessage('پرداخت ناموفق', 'پرداخت توسط شما لغو شد یا با خطا مواجه گردید.', 'error'));
    }

    try {
        const unverifiedResponse = await axios.post('https://api.zarinpal.com/pg/v4/payment/unverified.json', {
            merchant_id: ZARINPAL_MERCHANT_ID, authority: Authority,
        });

        const amount = unverifiedResponse.data.data.transactions[0].amount;

        const verificationResponse = await axios.post('https://api.zarinpal.com/pg/v4/payment/verify.json', {
            merchant_id: ZARINPAL_MERCHANT_ID, authority: Authority, amount: amount, 
        });

        const { data } = verificationResponse.data;

        if (data.code === 100 || data.code === 101) {
            const sheetName = planToSheetMap[amount.toString()];
            if (!sheetName) throw new Error(`پلنی برای مبلغ ${amount} تومان یافت نشد.`);

            const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID);
            await doc.useServiceAccountAuth({ client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: GOOGLE_PRIVATE_KEY, });

            await doc.loadInfo();

            // --- کد جدید برای عیب‌یابی ---
            const allSheetTitles = doc.sheetsByIndex.map(sheet => sheet.title);
            console.log('SHEETS FOUND BY API:', allSheetTitles);
            // --------------------------
            
            const sheet = doc.sheetsByTitle[sheetName];
            if (!sheet) throw new Error(`شیت با نام "${sheetName}" یافت نشد.`);
            
            const rows = await sheet.getRows();
            const availableLinkRow = rows.find(row => row.get('status') === 'unused');

            if (!availableLinkRow) {
                return res.status(500).send(generateResponseMessage('پرداخت موفق، تحویل ناموفق', `متاسفانه تمام لینک‌های اشتراک این پلن تمام شده است. لطفاً با پشتیبانی تماس بگیرید. کد پیگیری: ${data.ref_id}`, 'error'));
            }

            const userLink = availableLinkRow.get('link');
            availableLinkRow.set('status', 'used-' + new Date().toISOString());
            await availableLinkRow.save();

            res.status(200).send(generateResponseMessage('پرداخت شما موفقیت آمیز بود!', `لینک اشتراک شما آماده است. کد پیگیری: ${data.ref_id}`, 'success', userLink));
        
        } else {
            throw new Error(`تایید پرداخت با زرین‌پال ناموفق بود. کد خطا: ${data.code}`);
        }
    } catch (error) {
        console.error('Vercel Function Error:', error.message);
        res.status(500).send(generateResponseMessage('خطای سرور', `در پردازش تراکنش شما خطایی رخ داد. لطفاً با پشتیبانی تماس بگیرید. جزئیات خطا: ${error.message}`, 'error'));
    }
};
