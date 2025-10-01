const fetch = require('node-fetch');
const ZARINPAL_MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID;

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }
    try {
        // UPDATED: Added users to the de-structuring
        const { 
            amount, 
            description, 
            chat_id, 
            name, 
            email, 
            phone, 
            renewalIdentifier, 
            requestedPlan, 
            coupenCode,
            telegramUsername, 
            telegramId,
            users // NEW
        } = req.body;

        if (!amount) {
            return res.status(400).json({ error: 'Amount is required' });
        }

        const host = req.headers.host;
        const protocol = host.startsWith('localhost') ? 'http' : 'https';
        
        // UPDATED: Added users and description to queryParams
        const queryParams = new URLSearchParams({
            amount,
            chat_id: chat_id || 'none',
            name: name || '',
            email: email || '',
            phone: phone || '',
            renewalIdentifier: renewalIdentifier || '',
            requestedPlan: requestedPlan || '',
            coupenCode: coupenCode || '',
            telegramUsername: telegramUsername || '', 
            telegramId: telegramId || '',
            users: users || '1', // NEW
            description: description || '' // NEW
        }).toString();
        
        const callback_url = `${protocol}://${host}/api/verify?${queryParams}`;

        const response = await fetch('https://api.zarinpal.com/pg/v4/payment/request.json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                merchant_id: ZARINPAL_MERCHANT_ID,
                amount: Number(amount),
                callback_url: callback_url,
                description: description, // استفاده از description برای زرین‌پال
            }),
        });
        const result = await response.json();
        const data = result.data;
        
        // **نقطه حیاتی: اگر errors.length صفر نبود یا data.code برابر ۱۰۰ نبود، خطا می‌دهد**
        if (result.errors.length === 0 && data.code === 100 && data.authority) {
            res.status(200).json({ authority: data.authority });
        } else {
            console.error('Zarinpal Error:', result.errors);
            // خطای زرین‌پال به کاربر برگردانده می‌شود
            throw new Error(`Zarinpal request failed with code: ${data.code || result.errors.code}. See logs for details.`);
        }
    } catch (error) {
        console.error('Error starting payment:', error.message);
        // پاسخ خطا به مرورگر
        res.status(500).json({ error: 'خطای سرور در شروع پرداخت. لاگ‌ها را بررسی کنید.' });
    }
};