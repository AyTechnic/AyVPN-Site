const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// --- متغیرهای محیطی ---
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const COUPON_SHEET_TITLE = 'Coupen'; // نام شیت کوپن

// --- تابع کمکی برای اتصال به گوگل شیت ---
async function getDoc() {
    const serviceAccountAuth = new JWT({
        email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    return doc;
}

// --- تابع اصلی API ---
module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { coupenCode, originalAmount } = req.body;

    if (!coupenCode || !originalAmount) {
        return res.status(400).json({ error: 'کد تخفیف و مبلغ اولیه الزامی است.' });
    }

    try {
        const doc = await getDoc();
        const sheet = doc.sheetsByTitle[COUPON_SHEET_TITLE];
        if (!sheet) {
            console.error(`شیت کوپن با نام '${COUPON_SHEET_TITLE}' یافت نشد.`);
            return res.status(500).json({ error: 'خطای سرور در پردازش کوپن.' });
        }

        await sheet.loadHeaderRow(1);
        const rows = await sheet.getRows();
        const couponRow = rows.find(row => row.get('coupen') && row.get('coupen').toLowerCase() === coupenCode.toLowerCase());

        if (!couponRow) {
            return res.status(404).json({ error: 'کد تخفیف نامعتبر است.' });
        }

        // بررسی تاریخ انقضا
        const expiryDate = couponRow.get('expiryDate');
        if (expiryDate && new Date(expiryDate) < new Date()) {
            return res.status(400).json({ error: 'تاریخ انقضای این کد تخفیف گذشته است.' });
        }

        // بررسی تعداد دفعات استفاده
        const manyTimes = couponRow.get('manyTimes');
        if (manyTimes && manyTimes !== 'unlimited' && parseInt(manyTimes, 10) <= 0) {
            return res.status(400).json({ error: 'ظرفیت استفاده از این کد تخفیف به پایان رسیده است.' });
        }

        // محاسبه تخفیف
        const percent = parseInt(couponRow.get('percent'), 10) || 0;
        const price = parseInt(couponRow.get('price'), 10) || 0;
        let discountAmount = 0;

        if (percent > 0) {
            discountAmount = Math.round(originalAmount * percent / 100);
        } else if (price > 0) {
            discountAmount = price;
        }

        let finalAmount = originalAmount - discountAmount;
        if (finalAmount < 1000) { // حداقل قیمت ۱۰۰۰ تومان
            finalAmount = 1000;
            discountAmount = originalAmount - 1000;
        }
        
        if (discountAmount <= 0) {
             return res.status(400).json({ error: 'کد تخفیف برای این مبلغ قابل استفاده نیست.' });
        }

        return res.status(200).json({
            success: true,
            message: `تخفیف با موفقیت اعمال شد.`,
            finalAmount: finalAmount,
            discountAmount: discountAmount,
        });

    } catch (error) {
        console.error('Coupon Check API Error:', error.message);
        return res.status(500).json({ error: 'خطای داخلی سرور.' });
    }
};