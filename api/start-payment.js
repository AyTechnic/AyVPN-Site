const fetch = require('node-fetch');

const ZARINPAL_MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID;

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }
    try {
        const { amount, description } = req.body;
        if (!amount) return res.status(400).json({ error: 'Amount is required' });

        const host = req.headers.host;
        const protocol = host.startsWith('localhost') ? 'http' : 'https';
        const callback_url = `${protocol}://${host}/api/verify`;

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
