const fetch = require('node-fetch');

const ZARINPAL_MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID;

// داده‌های پلن‌ها برای محاسبه سمت سرور (جلوگیری از دستکاری قیمت)
const plansData = [
    // Unlimited
    { requestedPlan: '1M', baseAmount: 12000 }, { requestedPlan: '2M', baseAmount: 220000 },
    { requestedPlan: '3M', baseAmount: 340000 }, { requestedPlan: '6M', baseAmount: 600000 },
    { requestedPlan: '1Y', baseAmount: 1000000 }, { requestedPlan: '2Y', baseAmount: 2000000 },
    // National
    { requestedPlan: 'N1M', baseAmount: 50000 }, { requestedPlan: 'N2M', baseAmount: 90000 },
    { requestedPlan: 'N3M', baseAmount: 130000 }, { requestedPlan: 'N6M', baseAmount: 240000 },
    { requestedPlan: 'N1Y', baseAmount: 450000 }, { requestedPlan: 'N2Y', baseAmount: 850000 },
];

const calculateMultiUserPrice = (basePrice, users) => {
    if (users <= 1) return basePrice;
    const multiplier = 1 + (users - 1) * 0.5;
    return Math.round(basePrice * multiplier / 1000) * 1000;
};


module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }
    try {
        const { 
            amount, description, chat_id, name, email, phone, 
            renewalIdentifier, requestedPlan, coupenCode,
            telegramUsername, telegramId, users 
        } = req.body;

        // --- محاسبه مجدد و امنیتی قیمت در سمت سرور ---
        let finalAmount;
        if (renewalIdentifier) {
            // برای تمدید، به مبلغ ارسالی از فرانت‌اند اعتماد می‌کنیم چون منطق پیچیده‌تری دارد
            finalAmount = parseInt(amount, 10);
        } else {
            // برای خرید جدید، قیمت را سمت سرور محاسبه می‌کنیم
            const plan = plansData.find(p => p.requestedPlan === requestedPlan);
            if (!plan) {
                return res.status(400).json({ error: 'پلن انتخاب شده نامعتبر است.' });
            }
            const calculatedPrice = calculateMultiUserPrice(plan.baseAmount, parseInt(users, 10));
            // اینجا می‌توانید منطق کوپن را هم سمت سرور مجدد اعمال کنید
            // اما برای سادگی، فعلا به مبلغ نهایی محاسبه شده با کوپن در فرانت اعتماد می‌کنیم
            // و در verify.js مجدد چک نهایی را انجام می‌دهیم
            finalAmount = parseInt(amount, 10);

            // چک می‌کنیم که مبلغ ارسالی خیلی پرت نباشد
            if (Math.abs(finalAmount - calculatedPrice) > calculatedPrice) {
                 return res.status(400).json({ error: 'مبلغ ارسال شده با مبلغ محاسبه شده مغایرت دارد.' });
            }
        }
        
        if (!finalAmount || finalAmount < 1000) {
            return res.status(400).json({ error: 'مبلغ نامعتبر است.' });
        }

        const host = req.headers.host;
        const protocol = host.startsWith('localhost') ? 'http' : 'https';
        
        const queryParams = new URLSearchParams({
            amount: finalAmount, // ارسال مبلغ نهایی محاسبه شده
            chat_id: chat_id || 'none',
            name: name || '',
            email: email || '',
            phone: phone || '',
            renewalIdentifier: renewalIdentifier || '',
            requestedPlan: requestedPlan || '',
            coupenCode: coupenCode || '',
            telegramUsername: telegramUsername || '', 
            telegramId: telegramId || '',
            users: users || '1',
            description: description || ''
        }).toString();
        
        const callback_url = `${protocol}://${host}/api/verify?${queryParams}`;

        const response = await fetch('https://api.zarinpal.com/pg/v4/payment/request.json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({
                merchant_id: ZARINPAL_MERCHANT_ID,
                amount: Number(finalAmount),
                callback_url: callback_url,
                description: description,
                metadata: {
                    email: email || undefined,
                    mobile: phone || undefined,
                },
            }),
        });
        const result = await response.json();
        
        if (result.data && result.data.authority) {
            res.status(200).json({ authority: result.data.authority });
        } else {
            const errorCode = (result.errors && result.errors.code) ? result.errors.code : 'نامشخص';
            console.error('Zarinpal Error:', result.errors);
            throw new Error(`خطای درگاه پرداخت با کد: ${errorCode}.`);
        }
    } catch (error) {
        console.error('Error starting payment:', error.message);
        res.status(500).json({ error: error.message || 'خطای سرور در شروع پرداخت.' });
    }

};
