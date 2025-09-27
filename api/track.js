const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;

const planToSheetMap = {
    '120000': '30D', '220000': '60D', '340000': '90D',
    '600000': '180D', '1000000': '365D', '2000000': '730D',
};

module.exports = async (req, res) => {
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
        for (const sheetTitle of Object.values(planToSheetMap)) {
            const sheet = doc.sheetsByTitle[sheetTitle];
            if (sheet) {
                const rows = await sheet.getRows();
                rows.forEach(row => {
                    if (row.get('trackingId') === trackingId) {
                        purchases.push({
                            plan: sheetTitle,
                            date: row.get('purchaseDate'),
                            link: row.get('link'),
                            name: row.get('name'),
                            email: row.get('email'),
                            phone: row.get('phone'),
                            trackingId: row.get('trackingId')
                        });
                    }
                });
            }
        }
        
        if (purchases.length > 0) {
            return res.status(200).json(purchases.sort((a, b) => new Date(b.date) - new Date(a.date)));
        } else {
            return res.status(404).json({ error: 'No purchases found with this Tracking ID.' });
        }

    } catch (error) {
        console.error('Tracking Error:', error.message);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};
