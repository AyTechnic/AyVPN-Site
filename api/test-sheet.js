const { GoogleSpreadsheet } = require('google-spreadsheet');

// متغیرهای محیطی شما را می‌خواند
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'); 

// تابع اصلی تستر
module.exports = async (req, res) => {
    try {
        // 1. تلاش برای اتصال به فایل گوگل شیت شما
        const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID);
        await doc.useServiceAccountAuth({
            client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key: GOOGLE_PRIVATE_KEY,
        });

        await doc.loadInfo(); // بارگذاری اطلاعات کلی فایل

        // 2. تلاش برای پیدا کردن شیت '30D'
        const sheet = doc.sheetsByTitle['30D'];
        if (!sheet) {
            throw new Error('شیت با نام دقیق "30D" پیدا نشد.');
        }

        // 3. تلاش برای خواندن ردیف‌ها
        const rows = await sheet.getRows();
        if (rows.length === 0) {
            throw new Error('شیت "30D" خالی است و هیچ ردیفی ندارد.');
        }

        // 4. تلاش برای پیدا کردن اولین لینک استفاده نشده
        const availableLinkRow = rows.find(row => row.get('status') === 'unused');
        if (!availableLinkRow) {
            throw new Error('هیچ لینک استفاده نشده‌ای (unused) در شیت "30D" پیدا نشد.');
        }

        const firstLink = availableLinkRow.get('link');

        // 5. اگر تمام مراحل موفق بود، پیام موفقیت را نمایش می‌دهد
        res.status(200).send(`
            <html lang="fa" dir="rtl"><body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #2e7d32;">✅ اتصال به گوگل شیت موفق بود!</h1>
                <p>سیستم با موفقیت به فایل شما متصل شد و توانست اطلاعات را بخواند.</p>
                <p>اولین لینک اشتراک پیدا شده در شیت 30D:</p>
                <div style="background: #eee; padding: 15px; border-radius: 8px; direction: ltr;">${firstLink}</div>
            </body></html>
        `);

    } catch (error) {
        // اگر در هر مرحله‌ای خطا رخ دهد، آن را نمایش می‌دهد
        console.error('Google Sheet Test Error:', error.message);
        res.status(500).send(`
            <html lang="fa" dir="rtl"><body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #c62828;">❌ اتصال به گوگل شیت ناموفق بود!</h1>
                <p>جزئیات خطا:</p>
                <div style="background: #ffebee; padding: 15px; border-radius: 8px; direction: rtl; text-align: right;">${error.message}</div>
            </body></html>
        `);
    }
};
