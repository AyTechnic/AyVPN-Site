const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;

const planToSheetMap = {
    '1200': '30D', '220000': '60D', '340000': '90D',
    '600000': '180D', '1000': '365D', '2000000': '730D',
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
                const foundRow = rows.find(row => row.get('trackingId') === trackingId);
                if (foundRow) {
                    purchases.push({
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
            return res.status(200).json(purchases);
        } else {
            return res.status(404).json({ error: 'No purchases found with this Tracking ID.' });
        }

    } catch (error) {
        console.error('Tracking Error:', error.message);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};