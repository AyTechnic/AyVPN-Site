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

// تابع ساخت صفحه HTML موفقیت (برای وب)
function generateSuccessPage(details) {
    const { trackingId, userLink, previousPurchases, name } = details;
    
    let previousPurchasesHtml = '';
    if (previousPurchases && previousPurchases.length > 1) { // Only show if more than the current purchase exists
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
    <!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>پرداخت موفق - Ay Technic</title>
    <style>
        @font-face { font-family: 'Vazirmatn'; src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Bold.woff2') format('woff2'); font-weight: bold; }
        @font-face { font-family: 'Vazirmatn'; src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Regular.woff2') format('woff2'); font-weight: normal; }
        :root { --primary-color: #007bff; --success-color: #28a745; --bg-color: #f0f2f5; --card-bg: #ffffff; --text-color: #333; --border-color: #e0e0e0; }
        body { font-family: 'Vazirmatn', sans-serif; background: var(--bg-color); display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; }
        .container { background: var(--card-bg); border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); width: 100%; max-width: 500px; padding: 40px; text-align: center; border-top: 5px solid var(--success-color); animation: fadeIn 0.5s; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
        .icon { font-size: 4rem; color: var(--success-color); animation: pop 0.5s ease-out; }
        @keyframes pop { 0% { transform: scale(0); } 80% { transform: scale(1.2); } 100% { transform: scale(1); } }
        h1 { font-weight: bold; margin: 20px 0 10px; } p { color: #666; font-size: 1.1rem; }
        .subscription-box { background: #f8f9fa; border: 1px dashed var(--border-color); border-radius: 12px; padding: 20px; margin-top: 30px; position: relative; }
        .subscription-link { font-family: monospace; font-size: 1.2rem; word-break: break-all; color: var(--primary-color); font-weight: bold; }
        .actions { display: flex; justify-content: center; gap: 15px; margin-top: 20px; }
        .actions button { background: none; border: 1px solid var(--border-color); width: 45px; height: 45px; border-radius: 50%; cursor: pointer; transition: all 0.2s; display: flex; justify-content: center; align-items: center; }
        .actions button:hover { background: #e9ecef; border-color: #ccc; } .actions button svg { width: 22px; height: 22px; color: #555; }
        .timer { margin-top: 30px; } .timer-svg { width: 80px; height: 80px; transform: rotate(-90deg); }
        .timer-svg circle { transition: stroke-dashoffset 1s linear; }
        .timer-text { font-size: 1.8rem; font-weight: bold; color: var(--primary-color); position: relative; top: -65px; }
        .previous-purchases { margin-top: 40px; text-align: right; border-top: 1px solid var(--border-color); padding-top: 20px; }
        .previous-purchases h3 { font-size: 1.2rem; margin-bottom: 15px; } .previous-purchases ul { list-style: none; padding: 0; }
        .previous-purchases li { background: #f8f9fa; padding: 10px 15px; border-radius: 8px; margin-bottom: 10px; font-size: 0.9rem; }
        .plan-badge { background: #007bff; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8rem; margin-left: 10px; }
        .date { opacity: 0.8; } .link { display: block; margin-top: 5px; } .track-id { display: block; font-size: 0.8rem; opacity: 0.7; margin-top: 5px; }
        .footer-nav { margin-top: 30px; } .footer-nav a { color: #777; text-decoration: none; margin: 0 10px; font-size: 0.9rem; }
    </style></head><body><div class="container">
        <div class="icon">🎉</div><h1>پرداخت موفقیت‌آمیز بود!</h1>
        <p>${name ? `کاربر گرامی ${name}،` : ''} لینک اشتراک شما آماده است.</p>
        <p style="font-size:0.9rem; color:#888;">شماره پیگیری شما: <strong>${trackingId}</strong></p>
        <div class="subscription-box"><code class="subscription-link" id="subLink">${userLink}</code>
            <div class="actions">
                <button id="copyBtn" title="کپی لینک"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"></path></svg></button>
                <button id="openBtn" title="باز کردن لینک"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"></path></svg></button>
            </div></div>
        <div class="timer">
            <svg class="timer-svg"><circle r="35" cx="40" cy="40" fill="transparent" stroke="#e0e0e0" stroke-width="8"></circle><circle id="timer-circle" r="35" cx="40" cy="40" fill="transparent" stroke="var(--primary-color)" stroke-width="8" stroke-linecap="round" stroke-dasharray="219.9" stroke-dashoffset="219.9"></circle></svg>
            <div id="timer-text" class="timer-text">5</div></div>
        ${previousPurchasesHtml}
        <div class="footer-nav"><a href="https://shop.shaammy.ir">بازگشت به فروشگاه</a></div></div>
    <script>
        const subLink = document.getElementById('subLink').innerText;
        const copyBtn = document.getElementById('copyBtn');
        const openBtn = document.getElementById('openBtn');
        copyBtn.addEventListener('click', () => { navigator.clipboard.writeText(subLink).then(() => { copyBtn.title = 'کپی شد!'; setTimeout(() => { copyBtn.title = 'کپی لینک'; }, 2000); }); });
        openBtn.addEventListener('click', () => { window.open(subLink, '_blank'); });
        let timeLeft = 5;
        const timerText = document.getElementById('timer-text');
        const timerCircle = document.getElementById('timer-circle');
        const circumference = 2 * Math.PI * 35;
        timerCircle.style.strokeDashoffset = circumference;
        const interval = setInterval(() => {
            timeLeft--;
            timerText.innerText = timeLeft;
            const offset = (timeLeft / 5) * circumference;
            timerCircle.style.strokeDashoffset = offset;
            if (timeLeft <= 0) { clearInterval(interval); window.open(subLink, '_blank'); }
        }, 1000);
        setTimeout(() => { const offset = (timeLeft / 5) * circumference; timerCircle.style.strokeDashoffset = offset; }, 10);
    <\/script></body></html>`;
}

// تابع جدید برای ساخت صفحه موفقیت تمدید
function generateRenewSuccessPage(trackingId) {
    return `
    <!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>درخواست تمدید ثبت شد</title>
    <style>
        @font-face { font-family: 'Vazirmatn'; src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Bold.woff2') format('woff2'); font-weight: bold; }
        @font-face { font-family: 'Vazirmatn'; src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Regular.woff2') format('woff2'); font-weight: normal; }
        body { font-family: 'Vazirmatn', sans-serif; background: #f0f2f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; }
        .container { background: #fff; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); width: 100%; max-width: 500px; padding: 40px; text-align: center; border-top: 5px solid #17a2b8; animation: fadeIn 0.5s; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
        h1 { font-weight: bold; color: #17a2b8; } p { color: #666; font-size: 1.1rem; margin: 15px 0; }
        a { background: #17a2b8; color: white; text-decoration: none; padding: 10px 20px; border-radius: 8px; margin-top: 20px; display: inline-block; transition: background 0.3s; }
        a:hover { background: #138496; }
    </style></head><body><div class="container">
        <h1>✅ درخواست شما ثبت شد</h1>
        <p>درخواست تمدید اشتراک شما با موفقیت ثبت شد. در ساعات آینده پیام تکمیل فرآیند به اطلاع شما خواهد رسید.</p>
        <p style="font-size:0.9rem; color:#888;">شماره پیگیری پرداخت شما: <strong>${trackingId}</strong></p>
        <a href="https://shop.shaammy.ir">بازگشت به فروشگاه</a>
    </div></body></html>`;
}

module.exports = async (req, res) => {
    const { Authority, Status, amount, chat_id, name, email, phone, renewalIdentifier, requestedPlan } = req.query;

    try {
        if (Status !== 'OK') throw new Error('Payment was cancelled by user.');

        const verificationResponse = await fetch(`https://api.zarinpal.com/pg/v4/payment/verify.json`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ merchant_id: ZARINPAL_MERCHANT_ID, authority: Authority, amount: Number(amount) * 10 })
        });
        const result = await verificationResponse.json();
        const { data } = result;

        if (result.errors.length === 0 && (data.code === 100 || data.code === 101)) {
            const trackingId = data.ref_id.toString();
            const serviceAccountAuth = new JWT({
                email: GOOGLE_SERVICE_ACCOUNT_EMAIL, key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
            const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);
            await doc.loadInfo();

            // --- منطق تمدید اشتراک ---
            if (renewalIdentifier && renewalIdentifier !== '') {
                const renewSheet = doc.sheetsByTitle['Renew'];
                if (!renewSheet) throw new Error('شیت "Renew" یافت نشد.');
                
                const newRowData = {
                    renewalIdentifier, requestedPlan, requestDate: new Date().toISOString(),
                    name, email, phone,
                };
                let adminMessage;

                if (chat_id && chat_id !== 'none') { // from bot
                    newRowData.telegramUsername = name; // Storing firstname
                    newRowData.telegramId = email; // Storing telegram ID
                    adminMessage = `🔄 **درخواست تمدید (ربات)!** 🔄\n\n**مشخصه:** \`${renewalIdentifier}\`\n**پلن:** ${requestedPlan}\n**کاربر:** @${phone} (${email})\n**پیگیری:** \`${trackingId}\``;
                } else { // from web
                    adminMessage = `🔄 **درخواست تمدید (وب‌سایت)!** 🔄\n\n**مشخصه:** \`${renewalIdentifier}\`\n**پلن:** ${requestedPlan}\n**نام:** ${name || 'N/A'}\n**ایمیل:** ${email || 'N/A'}\n**تلفن:** ${phone || 'N/A'}\n**پیگیری پرداخت:** \`${trackingId}\``;
                }
                
                await renewSheet.addRow(newRowData);
                await bot.sendMessage(ADMIN_CHAT_ID, adminMessage, { parse_mode: 'Markdown' });

                if (chat_id && chat_id !== 'none') {
                    await bot.sendMessage(chat_id, '✅ درخواست تمدید شما با موفقیت ثبت شد.');
                    return res.redirect(`https://t.me/aylinvpnbot`);
                } else {
                    return res.status(200).send(generateRenewSuccessPage(trackingId));
                }
            }

            // --- منطق خرید اشتراک جدید ---
            const sheetName = planToSheetMap[amount.toString()];
            if (!sheetName) throw new Error(`پلنی برای مبلغ ${amount} تومان یافت نشد.`);
            
            const sheet = doc.sheetsByTitle[sheetName];
            if (!sheet) throw new Error(`شیت با نام "${sheetName}" یافت نشد.`);
            
            const rows = await sheet.getRows();
            const availableLinkRow = rows.find(row => row.get('status') === 'unused');
            if (!availableLinkRow) {
                if (chat_id && chat_id !== 'none') await bot.sendMessage(chat_id, '❌ پرداخت موفق بود اما تمام لینک‌های این پلن تمام شده است. لطفاً با پشتیبانی (@AyVPNsupport) تماس بگیرید.');
                throw new Error('No unused links available.');
            }
            
            const userLink = availableLinkRow.get('link');
            availableLinkRow.set('status', 'used');
            availableLinkRow.set('trackingId', trackingId);
            availableLinkRow.set('purchaseDate', new Date().toISOString());
            if(name) availableLinkRow.set('name', name);
            if(email) availableLinkRow.set('email', email);
            if(phone) availableLinkRow.set('phone', phone);
            await availableLinkRow.save();

            if (chat_id && chat_id !== 'none') {
                await bot.sendMessage(chat_id, `✅ پرداخت موفق!\n🔗 لینک شما:\n\`${userLink}\`\n🔢 شماره پیگیری: \`${trackingId}\``, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '👁️ مشاهده اشتراک', url: userLink }]] } });
                await bot.sendMessage(ADMIN_CHAT_ID, `🎉 **فروش جدید (ربات)!** 🎉\n**کاربر:** ${name} ([@${phone || 'N/A'}](tg://user?id=${email}))\n**پلن:** ${sheetName}\n**لینک:** \`${userLink}\`\n**پیگیری:** \`${trackingId}\``, { parse_mode: 'Markdown' });
                return res.redirect(`https://t.me/aylinvpnbot`);
            } else {
                const previousPurchases = await findPreviousPurchases(doc, email, phone);
                await bot.sendMessage(ADMIN_CHAT_ID, `🎉 **فروش جدید (وب‌سایت)!** 🎉\n**نام:** ${name || 'N/A'}\n**ایمیل:** ${email || 'N/A'}\n**تلفن:** ${phone || 'N/A'}\n**پلن:** ${sheetName}\n**لینک:** \`${userLink}\`\n**پیگیری:** \`${trackingId}\``, { parse_mode: 'Markdown' });
                return res.status(200).send(generateSuccessPage({ trackingId, userLink, previousPurchases, name }));
            }
        
        } else {
            throw new Error(`تایید پرداخت ناموفق بود. کد خطا: ${data.code || result.errors.code}`);
        }
    } catch (error) {
        console.error('Vercel Function Error:', error.message);
        if (chat_id && chat_id !== 'none') await bot.sendMessage(chat_id, '❌ در پردازش پرداخت شما خطایی رخ داد. لطفاً با پشتیبانی (@AyVPNsupport) تماس بگیرید.');
        return res.status(500).send(`<h1>خطا در سرور</h1><p>${error.message}</p>`);
    }
};

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
                    if(row.get('status') === 'used') {
                        previousPurchases.push({
                            plan: sheetTitle,
                            date: row.get('purchaseDate'),
                            link: row.get('link'),
                            trackingId: row.get('trackingId')
                        });
                    }
                }
            });
        }
    }
    return previousPurchases.sort((a, b) => new Date(b.date) - new Date(a.date));
}
