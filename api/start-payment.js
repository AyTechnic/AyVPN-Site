const fetch = require('node-fetch');
const ZARINPAL_MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID;

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }
    try {
        // دریافت پارامترهای جدید: userCount و اصلاح خطای املایی coupenCode به couponCode
        const { amount, description, chat_id, name, email, phone, renewalIdentifier, requestedPlan, couponCode, userCount } = req.body;
        
        if (!amount) {
            return res.status(400).json({ error: 'Amount is required' });
        }

        const host = req.headers.host;
        const protocol = host.startsWith('localhost') ? 'http' : 'https';
        
        // ارسال تمام پارامترها به verify.js
        const queryParams = new URLSearchParams({
            amount,
            chat_id: chat_id || 'none',
            name: name || '',
            email: email || '',
            phone: phone || '',
            renewalIdentifier: renewalIdentifier || '',
            requestedPlan: requestedPlan || '', // base amount of plan
            couponCode: couponCode || '', // ارسال کد کوپن به verify.js (FIXED TYPO)
            userCount: userCount || 1 // NEW: user count
        }).toString();
        
        const callback_url = `${protocol}://${host}/api/verify?${queryParams}`;

        const response = await fetch('https://api.zarinpal.com/pg/v4/payment/request.json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                merchant_id: ZARINPAL_MERCHANT_ID,
                amount: Number(amount) * 10, // CRITICAL FIX: Toman to Rial (x10)
                // FIX: Use a more detailed description including user count
                description: description || `خرید اشتراک ${requestedPlan} (${userCount || 1} کاربره)`, 
                callback_url: callback_url,
            }),
        });
        const result = await response.json();
        const data = result.data;
        if (result.errors.length === 0 && data.code === 100 && data.authority) {
            res.status(200).json({ authority: data.authority });
        } else {
            console.error('Zarinpal Error:', result.errors);
            throw new Error(`Zarinpal request failed with code: ${data.code || result.errors.code || result.errors[0]?.code}`);
        }
    } catch (error) {
        console.error('Error starting payment:', error.message);
        res.status(500).json({ error: 'Failed to start payment process.', details: error.message });
    }
};