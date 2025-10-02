// /api/coupen-check.js

/**
 * دیتابیس Mock برای کدهای تخفیف. 
 * در یک محیط عملیاتی، این داده‌ها باید از دیتابیس (مانند Google Sheet، MongoDB و ...) خوانده شوند.
 * * ساختار:
 * - type: 'percent' (درصد) یا 'fixed' (مبلغ ثابت به ریال)
 * - value: مقدار تخفیف (مثلاً ۱۰ برای ۱۰٪ یا ۵۰۰۰۰ برای ۵۰,۰۰۰ تومان)
 * - validFor: آرایه‌ای از کدهای پلن که کوپن برای آن‌ها مجاز است ('1M', '2M', 'Renew', ...)
 * - maxUses: حداکثر تعداد استفاده (برای پیاده‌سازی کامل)
 * - isActive: وضعیت فعال بودن کوپن
 */
const validCoupons = {
    'AYTECH10': { type: 'percent', value: 10, validFor: ['1M', '2M', '3M', '6M', '1Y', '2Y', 'Renew'], isActive: true },
    'SHAMMAY20': { type: 'percent', value: 20, validFor: ['6M', '1Y', '2Y'], isActive: true },
    'FRESH50K': { type: 'fixed', value: 500000, validFor: ['1M', '2M', '3M'], isActive: true }, // 50,000 تومان = 500,000 ریال
};

// تابع کمکی برای فرمت مبلغ
const formatAmount = (amount) => amount.toLocaleString('fa-IR');

module.exports = async (req, res) => {
    // تنها متدهای POST یا GET مجاز هستند
    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // دریافت اطلاعات از بدنه درخواست (برای POST) یا Query String (برای GET)
        const { coupenCode, requestedPlan, finalAmount } = req.method === 'POST' ? req.body : req.query;

        // --- اعتبارسنجی اولیه ---
        if (!coupenCode || !requestedPlan || !finalAmount) {
            return res.status(400).json({ error: 'Missing parameters: coupenCode, requestedPlan, and finalAmount are required.' });
        }
        
        const originalAmount = Number(finalAmount);
        const coupon = validCoupons[coupenCode.toUpperCase()];
        
        // --- ۱. بررسی وجود و فعال بودن کوپن ---
        if (!coupon || !coupon.isActive) {
            return res.status(404).json({ 
                error: 'کد تخفیف نامعتبر است.',
                newAmount: originalAmount,
                discountValue: 0
            });
        }
        
        // --- ۲. بررسی مجاز بودن کوپن برای پلن انتخابی ---
        if (!coupon.validFor.includes(requestedPlan)) {
            return res.status(400).json({ 
                error: 'این کد تخفیف برای پلن انتخابی شما قابل استفاده نیست.',
                newAmount: originalAmount,
                discountValue: 0
            });
        }

        // --- ۳. محاسبه تخفیف ---
        let discountValue = 0;
        let newAmount = originalAmount;
        
        if (coupon.type === 'percent') {
            discountValue = Math.round(originalAmount * (coupon.value / 100));
            newAmount = originalAmount - discountValue;
        } else if (coupon.type === 'fixed') {
            // value در دیتابیس بالا به ریال (مثل 500000) است
            discountValue = coupon.value;
            newAmount = originalAmount - discountValue;
        }

        // اطمینان از اینکه مبلغ نهایی منفی نشود
        if (newAmount < 0) {
            newAmount = 0;
        }

        // --- ۴. بازگشت نتیجه ---
        res.status(200).json({
            success: true,
            message: `✅ تخفیف ${coupon.value}${coupon.type === 'percent' ? '٪' : ' ریال'} با موفقیت اعمال شد.`,
            coupenCode: coupenCode.toUpperCase(),
            originalAmount: originalAmount,
            newAmount: newAmount, // مبلغ نهایی بعد از تخفیف (به ریال)
            discountValue: discountValue,
            formattedOriginalAmount: formatAmount(originalAmount / 10),
            formattedNewAmount: formatAmount(newAmount / 10),
            formattedDiscountValue: formatAmount(discountValue / 10)
        });

    } catch (error) {
        console.error('Error in coupen-check:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};