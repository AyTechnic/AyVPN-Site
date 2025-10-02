const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;

// NEW: نگاشت ثابت نام شیت‌ها برای track
const PLAN_SHEETS = ['30D', '60D', '90D', '180D', '365D', '730D', 'Renew'];

module.exports = async (req, res) => {
    // track.js برای پیگیری صرفاً trackingId را از query دریافت می‌کند
    const { trackingId } = req.query;

    if (!trackingId) {
        return res.status(400).json({ error: 'Tracking ID is required.' });
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
        
        // جستجو در تمامی شیت‌های پلن
        for (const sheetTitle of PLAN_SHEETS) {
            const sheet = doc.sheetsByTitle[sheetTitle];
            if (sheet) {
                // اطمینان از بارگیری هدرهای صحیح
                await sheet.loadHeaderRow(1);
                
                const rows = await sheet.getRows();
                // فرض می‌کنیم trackingId در ستون trackingId ذخیره می‌شود
                const foundRow = rows.find(row => row.get('trackingId') === trackingId);
                
                if (foundRow) {
                    purchases.push({
                        // نام شیت برای نمایش پلن کافی است (30D, Renew, ...)
                        plan: sheetTitle, 
                        date: foundRow.get('purchaseDate'),
                        link: foundRow.get('link'),
                        name: foundRow.get('name'),
                        email: foundRow.get('email'),
                        phone: foundRow.get('phone'),
                        trackingId: foundRow.get('trackingId')
                    });
                }
            }
        }
        
        if (purchases.length > 0) {
            // اگر بیش از یک سفارش با این شناسه (مثلاً تمدید) یافت شد، همه را برمی‌گردانیم
            return res.status(200).json(purchases);
        } else {
            return res.status(404).json({ error: 'No purchases found with this Tracking ID.' });
        }

    } catch (error) {
        console.error('Tracking Error:', error.message);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};