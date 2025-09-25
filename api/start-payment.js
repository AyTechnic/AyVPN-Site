import axios from 'axios';

// اطلاعات حساس از Environment Variables خوانده می‌شوند
const ZARINPAL_MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID; // این متغیرها اینجا لازم نیستند اما برای یکپارچگی ذکر شده‌اند

export default async function handler(req, res) {
    // فقط درخواست‌های POST را قبول می‌کنیم
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const { amount, description } = req.body;

        // چک می‌کنیم که مبلغ ارسال شده باشد
        if (!amount) {
            return res.status(400).json({ error: 'Amount is required' });
        }

        // آدرس بازگشت را اینجا به صورت ثابت تعریف می‌کنیم
        const callback_url = `https://${req.headers.host}/api/verify`;

        // درخواست به زرین‌پال برای ایجاد تراکنش و دریافت کد Authority
        const zarinpalResponse = await axios.post('https://api.zarinpal.com/pg/v4/payment/request.json', {
            merchant_id: ZARINPAL_MERCHANT_ID,
            amount: Number(amount),
            callback_url: callback_url,
            description: description,
        });

        const { data } = zarinpalResponse.data;

        // اگر درخواست موفق بود و کد Authority دریافت شد
        if (data.code === 100 && data.authority) {
            // کد Authority را به فرانت‌اند برمی‌گردانیم
            res.status(200).json({ authority: data.authority });
        } else {
            // در غیر این صورت، خطا را برمی‌گردانیم
            throw new Error(`Zarinpal request failed with code: ${data.code}`);
        }

    } catch (error) {
        console.error('Error starting payment:', error.message);
        res.status(500).json({ error: 'Failed to start payment process.', details: error.message });
    }
}
