const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;

// لیست تمام شیت‌هایی که باید جستجو شوند
const SEARCHABLE_SHEETS = ['30D', '60D', '90D', '180D', '365D', '730D', 'Renew'];

module.exports = async (req, res) => {
    const { identifier } = req.query;

    if (!identifier) {
        return res.status(400).json({ error: 'شناسه پیگیری (کد رهگیری، ایمیل یا شماره تماس) الزامی است.' });
    }

    try {
        const serviceAccountAuth = new JWT({
            email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
            key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);
        await doc.loadInfo();

        const purchases = [];
        const lowerCaseIdentifier = identifier.toLowerCase();

        for (const sheetTitle of SEARCHABLE_SHEETS) {
            const sheet = doc.sheetsByTitle[sheetTitle];
            if (sheet) {
                await sheet.loadHeaderRow(1);
                const rows = await sheet.getRows();

                rows.forEach(row => {
                    const trackingId = row.get('trackingId') || '';
                    const email = row.get('email') || '';
                    const phone = row.get('phone') || '';

                    if (
                        trackingId.toLowerCase() === lowerCaseIdentifier ||
                        email.toLowerCase() === lowerCaseIdentifier ||
                        phone.toLowerCase() === lowerCaseIdentifier
                    ) {
                        purchases.push({
                            plan: sheetTitle,
                            date: row.get(sheetTitle === 'Renew' ? 'requestDate' : 'purchaseDate'),
                            link: row.get('link') || null,
                            name: row.get('name'),
                            trackingId: row.get('trackingId'),
                        });
                    }
                });
            }
        }
        
        if (purchases.length > 0) {
            // مرتب‌سازی بر اساس تاریخ (جدیدترین اول)
            purchases.sort((a, b) => new Date(b.date) - new Date(a.date));
            return res.status(200).json(purchases);
        } else {
            return res.status(404).json({ error: 'هیچ سفارشی با این شناسه یافت نشد.' });
        }

    } catch (error) {
        console.error('Tracking API Error:', error.message);
        return res.status(500).json({ error: 'خطای داخلی سرور' });
    }
};