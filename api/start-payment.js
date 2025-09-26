const fetch = require('node-fetch');
const ZARINPAL_MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID;

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }
    try {
        // chat_id را از ورودی دریافت می‌کنیم
        const { amount, description, chat_id } = req.body;
        if (!amount || !chat_id) {
            return res.status(400).json({ error: 'Amount and Chat ID are required' });
        }

        const host = req.headers.host;
        const protocol = host.startsWith('localhost') ? 'http' : 'https';
        // chat_id را به آدرس بازگشت اضافه می‌کنیم
        const callback_url = `${protocol}://${host}/api/verify?chat_id=${chat_id}`;

        const response = await fetch('https://api.zarinpal.com/pg/v4/payment/request.json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                merchant_id: ZARINPAL_MERCHANT_ID,
                amount: Number(amount),
                callback_url: callback_url,
                description: description,
            }),
        });
        const result = await response.json();
        const data = result.data;
        if (result.errors.length === 0 && data.code === 100 && data.authority) {
            res.status(200).json({ authority: data.authority });
        } else {
            throw new Error(`Zarinpal request failed with code: ${data.code || result.errors.code}`);
        }
    } catch (error) {
        console.error('Error starting payment:', error.message);
        res.status(500).json({ error: 'Failed to start payment process.', details: error.message });
    }
};
