const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;

module.exports = async (req, res) => {
    try {
        const serviceAccountAuth = new JWT({
            email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
            key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);
        
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle['30D'];
        const sheet = doc.sheetsByTitle['60D'];
        if (!sheet) throw new Error('شیت با نام دقیق "30D" پیدا نشد.');
        
        const rows = await sheet.getRows();
        if (rows.length === 0) throw new Error('شیت "30D" خالی است.');

        const availableLinkRow = rows.find(row => row.get('status') === 'unused');
        if (!availableLinkRow) throw new Error('هیچ لینک استفاده نشده‌ای در شیت "30D" پیدا نشد.');

        const firstLink = availableLinkRow.get('link');

        res.status(200).send(`
            <html lang="fa" dir="rtl"><body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #2e7d32;">✅ اتصال به گوگل شیت موفق بود!</h1>
                <p>سیستم با موفقیت به فایل شما متصل شد.</p>
                <p>اولین لینک اشتراک پیدا شده در شیت 30D:</p>
                <div style="background: #eee; padding: 15px; border-radius: 8px; direction: ltr;">${firstLink}</div>
            </body></html>
        `);
    } catch (error) {
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
