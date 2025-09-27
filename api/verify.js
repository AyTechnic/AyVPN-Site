const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const fetch = require('node-fetch');
const TelegramBot = require('node-telegram-bot-api');

// --- متغیرهای شما ---
const ZARINPAL_MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = '5976170456';

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

const planToSheetMap = {
    '12000': '30D', '220000': '60D', '340000': '90D',
    '600000': '180D', '10000': '365D', '2000000': '730D',
};

// تابع ساخت صفحه HTML موفقیت
function generateSuccessPage(details) {
    const { trackingId, userLink, previousPurchases, name } = details;
    
    let previousPurchasesHtml = '';
    if (previousPurchases && previousPurchases.length > 1) {
        previousPurchasesHtml = `
            <div class="previous-purchases">
                <h3>📜 سابقه خریدهای شما</h3>
                <ul>
                    ${previousPurchases.filter(p => p.trackingId !== trackingId).map(p => `
                        <li>
                            <span class="plan-badge">${p.plan}</span>
                            <span class="date">${new Date(p.date).toLocaleDateString('fa-IR')}</span>
                            <code class="link">${p.link}</code>
                            <span class="track-id">پیگیری: ${p.trackingId}</span>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }

    return `
    <!DOCTYPE html>
    <html lang="fa" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>پرداخت موفق - Ay Technic</title>
        <style>
            @font-face { font-family: 'Vazirmatn'; src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Bold.woff2') format('woff2'); font-weight: bold; }
            @font-face { font-family: 'Vazirmatn'; src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Regular.woff2') format('woff2'); font-weight: normal; }
            :root { --primary-color: #007bff; --success-color: #28a745; --bg-color: #f0f2f5; --card-bg: #ffffff; --text-color: #333; --border-color: #e0e0e0; }
            body { font-family: 'Vazirmatn', sans-serif; background: var(--bg-color); display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; }
            .container { background: var(--card-bg); border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); width: 100%; max-width: 500px; padding: 40px; text-align: center; border-top: 5px solid var(--success-color); }
            .icon { font-size: 4rem; color: var(--success-color); animation: pop 0.5s ease-out; }
            @keyframes pop { 0% { transform: scale(0); } 80% { transform: scale(1.2); } 100% { transform: scale(1); } }
            h1 { font-weight: bold; margin: 20px 0 10px; }
            p { color: #666; font-size: 1.1rem; }
            .subscription-box { background: #f8f9fa; border: 1px dashed var(--border-color); border-radius: 12px; padding: 20px; margin-top: 30px; position: relative; }
            .subscription-link { font-family: monospace; font-size: 1.2rem; word-break: break-all; color: var(--primary-color); font-weight: bold; }
            .actions { display: flex; justify-content: center; gap: 15px; margin-top: 20px; }
            .actions button { background: none; border: 1px solid var(--border-color); width: 45px; height: 45px; border-radius: 50%; cursor: pointer; transition: all 0.2s; display: flex; justify-content: center; align-items: center; }
            .actions button:hover { background: #e9ecef; border-color: #ccc; }
            .actions button svg { width: 22px; height: 22px; color: #555; }
            .timer { margin-top: 30px; }
            .timer-svg { width: 80px; height: 80px; transform: rotate(-90deg); }
            .timer-svg circle { transition: stroke-dashoffset 1s linear; }
            .timer-text { font-size: 1.8rem; font-weight: bold; color: var(--primary-color); position: relative; top: -65px; }
            .previous-purchases { margin-top: 40px; text-align: right; border-top: 1px solid var(--border-color); padding-top: 20px; }
            .previous-purchases h3 { font-size: 1.2rem; margin-bottom: 15px; }
            .previous-purchases ul { list-style: none; padding: 0; }
            .previous-purchases li { background: #f8f9fa; padding: 10px 15px; border-radius: 8px; margin-bottom: 10px; font-size: 0.9rem; }
            .footer-nav { margin-top: 30px; }
            .footer-nav a { color: #777; text-decoration: none; margin: 0 10px; font-size: 0.9rem; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="icon">🎉</div>
            <h1>پرداخت موفقیت‌آمیز بود!</h1>
            <p>${name ? `کاربر گرامی ${name}،` : ''} لینک اشتراک شما آماده است.</p>
            <p style="font-size:0.9rem; color:#888;">شماره پیگیری شما: <strong>${trackingId}</strong></p>

            <div class="subscription-box">
                <code class="subscription-link" id="subLink">${userLink}</code>
                <div class="actions">
                    <button id="copyBtn" title="کپی لینک"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"></path></svg></button>
                    <button id="openBtn" title="باز کردن لینک"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"></path></svg></button>
                </div>
            </div>

            <div class="timer">
                <svg class="timer-svg">
                    <circle r="35" cx="40" cy="40" fill="transparent" stroke="#e0e0e0" stroke-width="8"></circle>
                    <circle id="timer-circle" r="35" cx="40" cy="40" fill="transparent" stroke="var(--primary-color)" stroke-width="8" stroke-linecap="round" stroke-dasharray="219.9" stroke-dashoffset="0"></circle>
                </svg>
                <div id="timer-text" class="timer-text">5</div>
            </div>
            
            ${previousPurchasesHtml}

            <div class="footer-nav">
                <a href="https://shop.shaammy.ir">بازگشت به فروشگاه</a>
            </div>
        </div>

        <script>
            const subLink = document.getElementById('subLink').innerText;
            const copyBtn = document.getElementById('copyBtn');
            const openBtn = document.getElementById('openBtn');

            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(subLink).then(() => {
                    copyBtn.title = 'کپی شد!';
                    setTimeout(() => { copyBtn.title = 'کپی لینک'; }, 2000);
                });
            });

            openBtn.addEventListener('click', () => {
                window.open(subLink, '_blank');
            });

            let timeLeft = 5;
            const timerText = document.getElementById('timer-text');
            const timerCircle = document.getElementById('timer-circle');
            const circumference = 2 * Math.PI * 35;

            const interval = setInterval(() => {
                timeLeft--;
                timerText.innerText = timeLeft;
                const offset = circumference - (timeLeft / 5) * circumference;
                timerCircle.style.strokeDashoffset = offset;

                if (timeLeft <= 0) {
                    clearInterval(interval);
//                     window.location.href = subLink;
                    window.open(subLink, '_blank');
                }
            }, 1000);
        <\/script>
    </body>
    </html>
    `;
}

module.exports = async (req, res) => {
    const { Authority, Status, amount, chat_id, name, email, phone } = req.query;

    try {
        if (Status !== 'OK') {
            throw new Error('Payment was cancelled by user.');
        }

        const verificationResponse = await fetch(`https://api.zarinpal.com/pg/v4/payment/verify.json`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ merchant_id: ZARINPAL_MERCHANT_ID, authority: Authority, amount: Number(amount) })
        });
        const result = await verificationResponse.json();
        const { data } = result;

        if (result.errors.length === 0 && (data.code === 100 || data.code === 101)) {
            const sheetName = planToSheetMap[amount.toString()];
            if (!sheetName) throw new Error(`پلنی برای مبلغ ${amount} تومان یافت نشد.`);

            const serviceAccountAuth = new JWT({
                email: GOOGLE_SERVICE_ACCOUNT_EMAIL, key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
            const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);

            await doc.loadInfo();
            const sheet = doc.sheetsByTitle[sheetName];
            if (!sheet) throw new Error(`شیت با نام "${sheetName}" یافت نشد.`);
            
            const rows = await sheet.getRows();
            const availableLinkRow = rows.find(row => row.get('status') === 'unused');
            if (!availableLinkRow) {
                 if (chat_id && chat_id !== 'none') {
                    await bot.sendMessage(chat_id, '❌ پرداخت شما موفق بود اما متاسفانه تمام لینک‌های اشتراک این پلن تمام شده است. لطفاً با پشتیبانی (@AyVPNsupport) تماس بگیرید.');
                }
                throw new Error('No unused links available.');
            }
            
            const userLink = availableLinkRow.get('link');
            // --- تغییر کلیدی: استفاده از شماره پیگیری زرین‌پال ---
            const trackingId = data.ref_id.toString(); 
            const purchaseDate = new Date().toISOString();

            // ذخیره اطلاعات در گوگل شیت
            availableLinkRow.set('status', 'used');
            availableLinkRow.set('trackingId', trackingId);
            availableLinkRow.set('purchaseDate', purchaseDate);
            if(name) availableLinkRow.set('name', name);
            if(email) availableLinkRow.set('email', email);
            if(phone) availableLinkRow.set('phone', phone);
            await availableLinkRow.save();

            const previousPurchases = await findPreviousPurchases(doc, email, phone);

            // اگر خرید از ربات بوده، به ربات پیام می‌دهیم
            if (chat_id && chat_id !== 'none') {
                await bot.sendMessage(chat_id, `✅ پرداخت موفق!\n🔗 لینک شما:\n\`${userLink}\`\n🔢 شماره پیگیری: \`${trackingId}\``, { parse_mode: 'Markdown' });
                await bot.sendMessage(ADMIN_CHAT_ID, `🎉 فروش جدید از طریق ربات! 🎉\n\nیک اشتراک ${sheetName} به مبلغ ${amount} تومان فروخته شد.`);
                return res.redirect(`https://t.me/aylinvpnbot`);
            } else { // اگر خرید از وب‌سایت بوده، صفحه وب نمایش می‌دهیم
                return res.status(200).send(generateSuccessPage({ trackingId, userLink, previousPurchases, name }));
            }
        
        } else {
            throw new Error(`تایید پرداخت با زرین‌پال ناموفق بود. کد خطا: ${data.code || result.errors.code}`);
        }
    } catch (error) {
        console.error('Vercel Function Error:', error.message);
        // اگر خرید از ربات بوده، پیام خطا در ربات ارسال می‌شود
        if (chat_id && chat_id !== 'none') {
            await bot.sendMessage(chat_id, '❌ در پردازش پرداخت شما خطایی رخ داد. لطفاً با پشتیبانی (@AyVPNsupport) تماس بگیرید.');
        }
        // در هر صورت، یک صفحه خطا برای کاربر وب نمایش داده می‌شود
        return res.status(500).send(generateResponseMessage('خطای سرور', `در پردازش تراکنش شما خطایی رخ داد. جزئیات خطا: ${error.message}`, 'error'));
    }
};

// تابع برای جستجوی خریدهای قبلی (باید بیرون از تابع اصلی باشد)
async function findPreviousPurchases(doc, email, phone) {
    if (!email && !phone) return [];
    
    const previousPurchases = [];
    const allSheetTitles = Object.values(planToSheetMap);

    for (const sheetTitle of allSheetTitles) {
        const sheet = doc.sheetsByTitle[sheetTitle];
        if (sheet) {
            const rows = await sheet.getRows();
            rows.forEach(row => {
                const rowEmail = row.get('email');
                const rowPhone = row.get('phone');
                if ((email && rowEmail === email) || (phone && rowPhone === phone)) {
                    previousPurchases.push({
                        plan: sheetTitle,
                        date: row.get('purchaseDate'),
                        link: row.get('link'),
                        trackingId: row.get('trackingId')
                    });
                }
            });
        }
    }
    return previousPurchases;
}
