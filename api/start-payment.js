const fetch = require('node-fetch');

const ZARINPAL_MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID;

// داده‌های پلن‌ها برای محاسبه سمت سرور (جلوگیری از دستکاری قیمت)
const plansData = [
    // Unlimited
    { requestedPlan: '1M', baseAmount: 1200 }, { requestedPlan: '2M', baseAmount: 220000 },
    { requestedPlan: '3M', baseAmount: 340000 }, { requestedPlan: '6M', baseAmount: 600000 },
    { requestedPlan: '1Y', baseAmount: 1000000 }, { requestedPlan: '2Y', baseAmount: 2000000 },
    // National
    { requestedPlan: 'N1M', baseAmount: 50000 }, { requestedPlan: 'N2M', baseAmount: 90000 },
    { requestedPlan: 'N3M', baseAmount: 130000 }, { requestedPlan: 'N6M', baseAmount: 240000 },
    { requestedPlan: 'N1Y', baseAmount: 450000 }, { requestedPlan: 'N2Y', baseAmount: 850000 },
];

const calculateMultiUserPrice = (basePrice, users) => {
    if (users <= 1) return basePrice;
    const multiplier = 1 + (users - 1) * 0.15; // 15% تخفیف برای هر کاربر اضافه
    return Math.round(basePrice * multiplier);
};

// تابع کمکی برای دریافت جزئیات کوپن از API check-coupon
async function getCoupenDetails(coupenCode, amount) {
    if (!coupenCode) return { discountAmountToman: 0, coupenIsValid: true };
    try {
        const response = await fetch(`${process.env.APP_URL}/api/check-coupon`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ coupenCode, originalAmount: amount }),
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            return { discountAmountToman: 0, coupenIsValid: false, error: result.error || 'کد تخفیف نامعتبر است.' };
        }

        return { discountAmountToman: result.discountAmount, coupenIsValid: true };

    } catch (error) {
        console.error('Error fetching coupon details:', error.message);
        return { discountAmountToman: 0, coupenIsValid: false, error: 'خطا در بررسی کد تخفیف.' };
    }
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }
    try {
        const { requestedPlan, users, coupenCode, name, email, phone, renewalIdentifier, chat_id, telegramUsername, telegramId, description } = req.body;
        
        const plan = plansData.find(p => p.requestedPlan === requestedPlan);
        if (!plan) {
            throw new Error('پلن درخواستی نامعتبر است.');
        }

        const basePrice = plan.baseAmount;
        const usersCount = parseInt(users) || 1;

        // 1. محاسبه قیمت چند کاربره
        const multiUserPrice = calculateMultiUserPrice(basePrice, usersCount);

        // 2. محاسبه تخفیف کوپن
        const { discountAmountToman, coupenIsValid, error: couponError } = await getCoupenDetails(coupenCode, multiUserPrice);
        
        if (coupenCode && !coupenIsValid) {
            throw new Error(`کد تخفیف نامعتبر: ${couponError}`);
        }

        // 3. محاسبه مبلغ نهایی (تومان)
        let finalAmountToman = multiUserPrice - discountAmountToman;
        if (finalAmountToman < 1000) {
            finalAmountToman = 1000;
        }

        // **مبلغ نهایی برای URL (تومان)
        const finalAmount = finalAmountToman;
        
        // **اصلاح لازم:** تبدیل مبلغ نهایی (تومان) به ریال برای ارسال به زرین‌پال
        const finalAmountRial = finalAmount * 10;
        
        // --- ساخت callback URL ---
        const host = req.headers.host;
        const protocol = host.startsWith('localhost') ? 'http' : 'https';

        const queryParams = new URLSearchParams({
            amount: finalAmount, // ارسال مبلغ به تومان در URL برای Verify
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

        // --- ارسال درخواست پرداخت به زرین‌پال ---
        const response = await fetch('https://api.zarinpal.com/pg/v4/payment/request.json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({
                merchant_id: ZARINPAL_MERCHANT_ID,
                amount: Number(finalAmountRial), // 👈 استفاده از مبلغ ریالی
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
        res.status(500).json({ error: 'Failed to start payment process.', details: error.message });
    }
};

