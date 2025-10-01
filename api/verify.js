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

// --- متغیر جدید: نام شیت تمدید ---
const RENEW_SHEET_TITLE = 'Renew'; 

// --- توابع عمومی Google Sheet ---
async function getOrCreateDoc() {
    const serviceAccountAuth = new JWT({
        email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    return doc;
}

// --- تابع checkAndApplyCoupon و findUserHistory و getMainMenuKeyboard (بدون تغییر) ---

async function checkAndApplyCoupon(doc, couponCode, amount) {
    if (!couponCode) return { finalAmount: amount, appliedCoupon: null, error: null };
    
    try {
        const couponSheet = doc.sheetsByTitle['Coupen'];
        if (!couponSheet) throw new Error('شیت Coupen یافت نشد. لطفاً شیت را ایجاد کنید.');

        const rows = await couponSheet.getRows();
        const couponRow = rows.find(row => row.get('Coupen') === couponCode);

        if (!couponRow) {
            return { finalAmount: amount, appliedCoupon: null, error: `کد تخفیف ${couponCode} نامعتبر است.` };
        }

        const percent = couponRow.get('percent');
        const price = couponRow.get('price');
        const manyTimes = couponRow.get('manyTimes');
        let discountAmount = 0;
        let finalAmount = amount;
        let type = 'percent';

        // 1. بررسی محدودیت‌ها
        if (manyTimes && manyTimes !== 'Unlimited') {
            const usedCount = manyTimes.includes('(') ? parseInt(manyTimes.split('(')[0]) : parseInt(manyTimes);
            if (usedCount <= 0) {
                return { finalAmount: amount, appliedCoupon: null, error: `تعداد استفاده از کوپن ${couponCode} به پایان رسیده است.` };
            }
        }
        
        if (price && price.includes('(')) {
            // Price-based coupon, check remaining balance
            const parts = price.match(/(\d+)\s*\((.*)\)/);
            if (parts && parseInt(parts[1]) <= 0) {
                 return { finalAmount: amount, appliedCoupon: null, error: `موجودی کوپن ${couponCode} به پایان رسیده است.` };
            }
        }

        // 2. محاسبه تخفیف
        if (percent) {
            type = 'percent';
            const percentValue = parseFloat(percent.replace('%', ''));
            discountAmount = Math.round(amount * (percentValue / 100));
            finalAmount = amount - discountAmount;
        } else if (price) {
            type = 'price';
            const parts = price.match(/(\d+)\s*(\((.*)\))?/);
            const remainingBalance = parts ? parseInt(parts[1]) : parseInt(price);
            
            discountAmount = Math.min(amount, remainingBalance);
            finalAmount = amount - discountAmount;
        } else {
            return { finalAmount: amount, appliedCoupon: null, error: `نوع تخفیف کوپن ${couponCode} مشخص نیست.` };
        }
        
        finalAmount = Math.max(0, finalAmount); // قیمت نهایی نباید منفی شود

        return { 
            finalAmount, 
            appliedCoupon: {
                code: couponCode,
                type: type,
                discount: discountAmount,
                originalRow: couponRow,
            },
            error: null 
        };

    } catch (error) {
        console.error('Coupon Check Error:', error.message);
        return { finalAmount: amount, appliedCoupon: null, error: 'خطا در بررسی کوپن: ' + error.message };
    }
}

async function findUserHistory(doc, chat_id) {
    if (!chat_id || chat_id === 'none') return [];
    
    const allPurchases = [];
    const allSheetTitles = Object.values(planToSheetMap);

    for (const sheetTitle of allSheetTitles) {
        const sheet = doc.sheetsByTitle[sheetTitle];
        if (sheet) {
            const rows = await sheet.getRows();
            rows.forEach(row => {
                const rowChatId = row.get('chat_id');
                // از email یا phone برای کاربران وب و از chat_id برای کاربران تلگرام استفاده می‌کنیم.
                const identifierMatch = (chat_id === 'none' && (row.get('email') === chat_id || row.get('phone') === chat_id)) 
                                        || (chat_id !== 'none' && rowChatId && rowChatId.toString() === chat_id.toString());

                if (identifierMatch) {
                    // اطمینان حاصل می‌کنیم که فقط ردیف‌های 'used' (خرید شده) را برمی‌گردانیم
                    if(row.get('status') && row.get('status').toLowerCase() === 'used') {
                        allPurchases.push({
                            plan: sheetTitle,
                            purchaseDate: row.get('purchaseDate'),
                            link: row.get('link'),
                            trackingId: row.get('trackingId'),
                            expiryDate: row.get('expiryDate') || 'نامشخص', 
                        });
                    }
                }
            });
        }
    }
    // مرتب‌سازی بر اساس تاریخ خرید (جدیدترین اول)
    return allPurchases.sort((a, b) => new Date(b.purchaseDate) - new Date(a.purchaseDate));
}

function getMainMenuKeyboard(hasHistory) {
     const buttons = [
        [{ text: '🛒 خرید پلن نامحدود', callback_data: 'menu_buy_unlimited' }],
        // [{ text: '🇮🇷 خرید پلن ملی', callback_data: 'menu_buy_national' }],
        [{ text: '🛠️ راهنمای اتصال', callback_data: 'menu_apps' }],
        [{ text: '👤 پشتیبانی', url: 'https://t.me/AyVPNsupport' }],
    ];

    if (hasHistory) {
         buttons.unshift([{ text: '🔄 تمدید اشتراک / مشاهده سابقه', callback_data: 'menu_renew_info' }]);
    }
    
    return {
        reply_markup: {
            inline_keyboard: buttons
        },
        parse_mode: 'Markdown'
    };
}


// --- تابع ساخت صفحه HTML موفقیت تمدید ---
function generateRenewalSuccessPage(details) {
    const { trackingId, renewalIdentifier } = details;
    
    // استایل از generateSuccessPage کپی شده است، فقط محتوا تغییر می‌کند
    return `
    <!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>درخواست تمدید ثبت شد - Ay Technic</title>
    <style>
        @font-face { font-family: 'Vazirmatn'; src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Bold.woff2') format('woff2'); font-weight: bold; }
        @font-face { font-family: 'Vazirmatn'; src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Regular.woff2') format('woff2'); font-weight: normal; }
        :root { --primary-color: #007bff; --success-color: #28a745; --bg-color: #f0f2f5; --card-bg: #ffffff; --text-color: #333; --border-color: #e0e0e0; }
        body { font-family: 'Vazirmatn', sans-serif; background: var(--bg-color); display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; }
        .container { background: var(--card-bg); border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); width: 100%; max-width: 500px; padding: 40px; text-align: center; border-top: 5px solid var(--primary-color); animation: fadeIn 0.5s; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-20px); } to { transform: translateY(0); } }
        .icon { font-size: 4rem; color: var(--primary-color); animation: pop 0.5s ease-out; }
        @keyframes pop { 0% { transform: scale(0); } 80% { transform: scale(1.2); } 100% { transform: scale(1); } }
        h1 { font-weight: bold; margin: 20px 0 10px; } p { color: #666; font-size: 1.1rem; }
        .info-box { background: #f8f9fa; border: 1px dashed var(--border-color); border-radius: 12px; padding: 20px; margin-top: 30px; position: relative; text-align: right;}
        .info-box p { color: #333; font-size: 1rem; margin: 5px 0; }
        .info-box strong { color: #000; }
        .footer-nav { margin-top: 30px; } .footer-nav a { color: #777; text-decoration: none; margin: 0 10px; font-size: 0.9rem; }
    </style></head><body><div class="container">
        <div class="icon">📝</div><h1>درخواست تمدید شما ثبت شد!</h1>
        <p>درخواست تمدید شما با موفقیت ثبت گردید.</p>
        <div class="info-box">
            <p><strong>شناسه/لینک وارد شده:</strong> <code>${renewalIdentifier}</code></p>
            <p><strong>شماره پیگیری پرداخت:</strong> <strong>${trackingId}</strong></p>
        </div>
        <p style="margin-top: 20px; color: var(--success-color); font-weight: bold;">در ساعات آینده نتیجه تمدید و فعالسازی مجدد اشتراک شما به اطلاعتان خواهد رسید.</p>
        <div class="footer-nav">
            <a href="https://t.me/AyVPNsupport" target="_blank">پشتیبانی</a> | <a href="/">صفحه اصلی</a>
        </div>
    </div></body></html>
    `;
}


// تابع ساخت صفحه HTML موفقیت (برای وب) - شامل تعداد کاربران
function generateSuccessPage(details) {
    const { trackingId, userLink, previousPurchases, name, requestedUsers } = details;
    
    let previousPurchasesHtml = '';
    if (previousPurchases && previousPurchases.length > 0) {
        previousPurchasesHtml = `
            <div class="previous-purchases">
                <h3>📜 سابقه خریدهای شما</h3>
                <ul>
                    ${previousPurchases.map(p => `
                        <li>
                            <span class="plan-badge">${p.plan}</span>
                            <span class="date">${new Date(p.purchaseDate).toLocaleDateString('fa-IR')}</span>
                            <code class="link">${p.link}</code>
                            <span class="track-id">پیگیری: ${p.trackingId}</span>
                            <span class="status-badge">${p.expiryDate === 'نامشخص' || new Date(p.expiryDate) > new Date() ? 'فعال' : 'منقضی شده'}</span>
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
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-20px); } to { transform: translateY(0); } }
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
        .previous-purchases li { background: #f8f9fa; padding: 10px 15px; border-radius: 8px; margin-bottom: 10px; font-size: 0.9rem; position: relative; }
        .plan-badge { background: #007bff; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8rem; margin-left: 10px; }
        .status-badge { position: absolute; left: 15px; top: 10px; font-size: 0.8rem; padding: 2px 8px; border-radius: 12px; background: #28a745; color: white; }
        .date { opacity: 0.8; } .link { display: block; margin-top: 5px; } .track-id { display: block; font-size: 0.8rem; opacity: 0.7; margin-top: 5px; }
        .footer-nav { margin-top: 30px; } .footer-nav a { color: #777; text-decoration: none; margin: 0 10px; font-size: 0.9rem; }
    </style></head><body><div class="container">
        <div class="icon">🎉</div><h1>پرداخت موفقیت‌آمیز بود!</h1>
        <p>${name ? `کاربر گرامی ${name}،` : ''} لینک اشتراک شما آماده است.</p>
        <p style="font-size:0.9rem; color:#888;">شماره پیگیری شما: <strong>${trackingId}</strong></p>
        ${requestedUsers && requestedUsers > 1 ? `<p style="font-size:1rem; color:#444; font-weight: bold;">تعداد کاربران: ${requestedUsers} نفر</p>` : ''}
        <div class="subscription-box"><code class="subscription-link" id="subLink">${userLink}</code>
            <div class="actions">
                <button id="copyBtn" title="کپی لینک"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"></path></svg></button>
                <button id="openBtn" title="باز کردن لینک"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h11c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"></path></svg></button>
            </div>
        </div>
        
        ${previousPurchasesHtml}

        <div class="footer-nav">
            <a href="https://t.me/AyVPNsupport" target="_blank">پشتیبانی</a> | <a href="/">صفحه اصلی</a>
        </div>
    </div>
    <script>
        document.getElementById('copyBtn').addEventListener('click', () => {
            const link = document.getElementById('subLink').innerText;
            navigator.clipboard.writeText(link).then(() => {
                alert('لینک اشتراک با موفقیت کپی شد!');
            });
        });
        document.getElementById('openBtn').addEventListener('click', () => {
            const link = document.getElementById('subLink').innerText;
            window.open(link, '_blank');
        });
    </script>
    </body></html>
    `;
}

// --- تابع اصلی: تأیید پرداخت ---
module.exports = async (req, res) => {
    // UPDATED: Added telegramUsername, telegramId, users, and description
    const { 
        Authority, 
        Status, 
        amount, 
        chat_id, 
        name, 
        email, 
        phone, 
        renewalIdentifier, 
        requestedPlan, 
        coupenCode, 
        telegramUsername, 
        telegramId,
        users,
        description
    } = req.query;
    
    // تبدیل ریال به تومان برای محاسبه دقیق
    const amountToman = Math.floor(Number(amount) / 10); 
    const isTelegram = chat_id && chat_id !== 'none';
    const isRenewal = renewalIdentifier && renewalIdentifier.length > 5; // Check if renewal is requested
    const isSuccessful = Status === 'OK';
    const isWeb = !isTelegram;
    
    let currentLink = ''; // لینک نهایی اشتراک (برای خرید جدید)
    const doc = await getOrCreateDoc();

    try {
        if (!isSuccessful) {
             // ... [کد خطا و عدم موفقیت - در صورت برگشت از درگاه با وضعیت ناموفق] ...
             if (isTelegram) await bot.sendMessage(chat_id, '❌ پرداخت ناموفق بود. لطفاً دوباره تلاش کنید یا با پشتیبانی تماس بگیرید.');
             return res.status(400).send(`<h1>پرداخت ناموفق</h1><p>کد پیگیری: ${Authority}. پرداخت انجام نشد.</p>`);
        }
        
        // --- وریفای درگاه زرین پال ---
        const verificationResponse = await fetch('https://api.zarinpal.com/pg/v4/payment/verify.json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                merchant_id: ZARINPAL_MERCHANT_ID,
                amount: Number(amount), // ریال
                authority: Authority,
            }),
        });
        const verificationResult = await verificationResponse.json();
        const data = verificationResult.data;

        if (verificationResult.errors.length === 0 && data.code === 100) {
            // --- ۱. اعمال منطق کوپن قبل از ثبت ---
            let finalAmount = amountToman;
            let appliedCoupon = null;
            let couponError = null;
            
            if (coupenCode) {
                const couponResult = await checkAndApplyCoupon(doc, coupenCode, amountToman);
                finalAmount = couponResult.finalAmount;
                appliedCoupon = couponResult.appliedCoupon;
                couponError = couponResult.error;
                
                if (couponError) {
                    console.warn(`Coupon check failed after successful payment: ${couponError}`);
                }
            }
            
            const trackingId = data.ref_id.toString();
            // ۲. منطق انتخاب شیت مقصد (تضمین ثبت در شیت Renew)
let sheetTitle;

if (renewalIdentifier && renewalIdentifier.length > 0) {
    // اگر از بخش تمدید شروع شده (شناسه تمدید پر شده)، بدون چون و چرا در شیت Renew ثبت شود.
    sheetTitle = RENEW_SHEET_TITLE; 
} else {
    // اگر از بخش تمدید شروع نشده (خرید جدید، شامل اشتراک ملی)، از نگاشت پلن استفاده شود.
    sheetTitle = planToSheetMap[requestedPlan]; 
}

            // --- ۲. منطق ثبت: تمدید (شیت Renew) یا خرید جدید (شیت پلن) ---
            if (isRenewal) {
                // ============== منطق تمدید: ثبت در شیت Renew ==============
                const renewSheet = doc.sheetsByTitle[RENEW_SHEET_TITLE];
                if (!renewSheet) {
                    // اگر شیت Renew وجود نداشت، خطا می‌دهیم
                    throw new Error(`Sheet for renewal '${RENEW_SHEET_TITLE}' not found. Please create the sheet.`);
                }

                // ثبت درخواست تمدید جدید در شیت Renew
                await renewSheet.addRow({
                    renewalIdentifier: renewalIdentifier, // لینک یا شناسه کاربری
                    requestedPlan: sheetTitle, // مثلاً 30D
                    name: name || '',
                    email: email || '',
                    phone: phone || '',
                    telegramUsername: telegramUsername || '',
                    telegramId: telegramId || chat_id || '', // use telegramId if provided, fallback to chat_id
                    requestDate: new Date().toLocaleString('fa-IR'),
                    trackingId: trackingId,
                    amount: finalAmount, // مبلغ پس از تخفیف (به تومان)
                    coupen: coupenCode ? `${coupenCode} | ${appliedCoupon.discount} تخفیف` : '',
                    users: users || '1', // تعداد کاربران
                    description: description || '',
                });

                // --- اطلاع‌رسانی به ادمین برای درخواست تمدید جدید ---
                const adminMessage = `🚨 درخواست تمدید جدید ثبت شد! 🚨
**لینک/شناسه کاربر**: \`${renewalIdentifier}\`
**پلن**: ${sheetTitle}
**تعداد کاربران**: ${users || '1'}
**مبلغ**: ${finalAmount.toLocaleString('fa-IR')} تومان
**کد پیگیری**: ${trackingId}
**کاربر تلگرام**: ${telegramUsername ? `@${telegramUsername}` : (isTelegram ? `[ID: ${chat_id}]` : 'ندارد')}
**توضیحات**: ${description || 'ندارد'}`;
                await bot.sendMessage(ADMIN_CHAT_ID, adminMessage, { parse_mode: 'Markdown' });


            } else {
                // ============== منطق خرید جدید: تخصیص لینک از شیت پلن ==============
                const sheet = doc.sheetsByTitle[sheetTitle];
                
                if (!sheet) throw new Error(`Sheet for plan ${requestedPlan} (${sheetTitle}) not found. Please ensure the Google Sheet and planToSheetMap are correct.`);
                
                // الف. پیدا کردن اولین ردیف (لینک) آزاد (ردیفی که 'status' آن خالی یا 'available' باشد)
                const allRows = await sheet.getRows();
                const availableLinkRow = allRows.find(row => 
                    !row.get('status') || row.get('status').toLowerCase() === 'available'
                );

                if (!availableLinkRow) {
                    // اگر لینک آزاد پیدا نشد، خطا می‌دهیم و به ادمین اطلاع می‌دهیم
                    const noLinkError = `❌ اخطار جدی: تمام لینک‌های موجود برای پلن ${sheetTitle} فروخته شده‌اند.
Authority: ${Authority}
Chat ID: ${chat_id}`;
                    await bot.sendMessage(ADMIN_CHAT_ID, noLinkError);

                    // برای کاربر هم پیام مناسب ارسال می‌کنیم و پول را برمی‌گردانیم (نیاز به API برگشت وجه زرین پال دارید)
                    const userMessage = isTelegram ? 'متأسفانه در حال حاضر لینک آزاد برای این پلن موجود نیست. لطفاً با پشتیبانی (@AyVPNsupport) تماس بگیرید.' :
                        `<h1>خطا در تخصیص لینک</h1><p>متأسفانه در حال حاضر لینک آزاد برای این پلن موجود نیست.</p><p>لطفاً با پشتیبانی تماس بگیرید و شماره پیگیری ${Authority} را اعلام کنید.</p>`;
                    
                    if (isTelegram) await bot.sendMessage(chat_id, userMessage);
                    return res.status(503).send(userMessage);
                }
                
                // ب. گرفتن لینک از ردیف موجود
                currentLink = availableLinkRow.get('link'); 
                
                // ج. پر کردن مشخصات کاربر در ردیف لینک موجود و ذخیره آن (UPDATED: Added users and description)
                availableLinkRow.set('name', name || '');
                availableLinkRow.set('email', email || '');
                availableLinkRow.set('phone', phone || '');
                availableLinkRow.set('purchaseDate', new Date().toLocaleString('fa-IR'));
                availableLinkRow.set('trackingId', trackingId);
                availableLinkRow.set('amount', finalAmount); // مبلغ پس از تخفیف (به تومان)
                availableLinkRow.set('status', 'used'); // مهم: تغییر وضعیت به 'used'
                availableLinkRow.set('chat_id', chat_id);
                availableLinkRow.set('coupen', coupenCode ? `${coupenCode} | ${appliedCoupon.discount} تخفیف` : ''); 
                availableLinkRow.set('users', users || '1'); // NEW: تعداد کاربران
                availableLinkRow.set('description', description || ''); // NEW: توضیحات
                availableLinkRow.set('telegramUsername', telegramUsername || ''); // NEW: نام کاربری تلگرام (اگر از وب آمده باشد)


                await availableLinkRow.save(); // ذخیره تغییرات در ردیف موجود
                
                // --- اطلاع‌رسانی به ادمین برای خرید جدید ---
                const adminMessage = `🛍️ خرید جدید ثبت شد! 🛍️
**پلن**: ${sheetTitle}
**تعداد کاربران**: ${users || '1'}
**مبلغ**: ${finalAmount.toLocaleString('fa-IR')} تومان
**لینک**: \`${currentLink}\`
**کد پیگیری**: ${trackingId}`;
                await bot.sendMessage(ADMIN_CHAT_ID, adminMessage, { parse_mode: 'Markdown' });

            }
            
            // --- ۳. به‌روزرسانی شیت کوپن پس از موفقیت ---
            if (appliedCoupon && appliedCoupon.originalRow) {
                const row = appliedCoupon.originalRow;
                const manyTimes = row.get('manyTimes');
                const price = row.get('price');
                
                if (appliedCoupon.type === 'percent' && manyTimes && manyTimes !== 'Unlimited') {
                    // کاهش تعداد دفعات (درصد)
                    const parts = manyTimes.match(/(\d+)\s*(\((.*)\))?/);
                    let initialCount = parts && parts[3] ? parseInt(parts[3]) : parseInt(parts[1]);
                    let remainingCount = parts ? parseInt(parts[1]) - 1 : parseInt(manyTimes) - 1;
                    
                    if (remainingCount >= 0) {
                        row.set('manyTimes', `${remainingCount} (${initialCount})`);
                        await row.save();
                    }
                } else if (appliedCoupon.type === 'price') {
                    // کاهش مبلغ (ثابت)
                    const parts = price.match(/(\d+)\s*(\((.*)\))?/);
                    let initialBalance = parts && parts[3] ? parseInt(parts[3]) : parseInt(parts[1]);
                    let remainingBalance = parts ? parseInt(parts[1]) - appliedCoupon.discount : parseInt(price) - appliedCoupon.discount;
                    
                    if (remainingBalance >= 0) {
                        row.set('price', `${remainingBalance} (${initialBalance})`);
                        await row.save();
                    }
                }
            }


            // --- ۴. ارسال پیام و ریدایرکت ---
            
            // وب:
            if (isWeb) {
                if (isRenewal) {
                    // ریدایرکت به صفحه موفقیت تمدید
                    return res.status(200).send(generateRenewalSuccessPage({
                        trackingId: trackingId,
                        renewalIdentifier: renewalIdentifier,
                    }));
                } else {
                    // ریدایرکت به صفحه موفقیت خرید جدید
                    // در حالت وب، برای پیدا کردن سابقه، email را به عنوان chat_id ارسال می‌کنیم (فرض بر این است که email/phone شناسه کاربر هستند)
                    const previousPurchases = await findUserHistory(doc, email || phone); 
                    return res.status(200).send(generateSuccessPage({
                        trackingId: trackingId,
                        userLink: currentLink,
                        name: name,
                        previousPurchases: previousPurchases,
                        requestedUsers: users // NEW
                    }));
                }
            }
            
            // تلگرام:
            if (isTelegram) {
                if (isRenewal) {
                    // پیام موفقیت تمدید
                    const messageText = `📝 درخواست تمدید شما با موفقیت ثبت شد!
**شناسه/لینک وارد شده**: \`${renewalIdentifier}\`
شماره پیگیری پرداخت: **${trackingId}**

در ساعات آینده نتیجه تمدید و فعالسازی مجدد اشتراک شما به اطلاعتان خواهد رسید.

${coupenCode && appliedCoupon ? `✅ کد تخفیف **${coupenCode}** با موفقیت اعمال شد و مبلغ **${appliedCoupon.discount}** تومان تخفیف گرفتید.` : ''}
`;
                    await bot.sendMessage(chat_id, messageText, { parse_mode: 'Markdown' });
                } else {
                    // پیام موفقیت خرید جدید
                    const messageText = `🎉 پرداخت شما با موفقیت انجام شد!
شماره پیگیری: **${trackingId}**

لینک اشتراک شما:
\`${currentLink}\`

${users && users > 1 ? `تعداد کاربران: **${users}** نفر` : ''}

${coupenCode && appliedCoupon ? `✅ کد تخفیف **${coupenCode}** با موفقیت اعمال شد و مبلغ **${appliedCoupon.discount}** تومان تخفیف گرفتید.` : ''}

برای آموزش اتصال: [راهنمای اتصال](https://t.me/Ay_VPN)
برای دریافت پشتیبانی: [پشتیبانی]
`;
                    // ارسال لینک اشتراک به کاربر
                    await bot.sendMessage(chat_id, messageText, { parse_mode: 'Markdown' });
                }
                
                // بازگشت به منوی اصلی
                const hasHistory = (await findUserHistory(doc, chat_id)).length > 0;
                const mainKeyboard = getMainMenuKeyboard(hasHistory); 
                await bot.sendMessage(chat_id, 'لطفاً سرویس مورد نظر خود را انتخاب کنید:', mainKeyboard);
                return res.status(200).send('OK');
            }


        } else {
            // --- منطق خطا در تأیید نهایی زرین پال ---
            
            // استخراج کد و پیام خطا
            const errorDetails = verificationResult.errors.length > 0 
                ? verificationResult.errors[0] // خطا از سمت API (مثلا ساختار اشتباه درخواست)
                : data; // خطا از سمت زرین پال (مثلا کد 101: تراکنش قبلا وریفای شده)

            const errorCode = errorDetails.code || 'نامشخص';
            const errorMessage = errorDetails.message || `خطای درگاه زرین پال با کد: ${errorCode}`;

            console.error(`ZarinPal Verification Failed - Authority: ${Authority}, Code: ${errorCode}, Message: ${errorMessage}`);
            
            // ارسال پیام به ادمین برای بررسی تراکنش ناموفق
            const adminMessage = `⚠️ اخطار: تأیید پرداخت زرین پال ناموفق!
Authority: ${Authority}
Chat ID: ${chat_id}
نام: ${name || 'نامشخص'}
مبلغ درگاه: ${amountToman} تومان
کد/پیام خطا: ${errorCode} / ${errorMessage}`;
            await bot.sendMessage(ADMIN_CHAT_ID, adminMessage);

            // ارسال پیام خطا به کاربر تلگرام
            if (isTelegram) {
                const userMessage = `❌ تأیید نهایی پرداخت شما ناموفق بود.
شماره پیگیری (Authority): **${Authority}**
لطفاً با پشتیبانی (@AyVPNsupport) تماس بگیرید و شماره پیگیری بالا را اعلام کنید تا مشکل شما بررسی شود.`;
                await bot.sendMessage(chat_id, userMessage, { parse_mode: 'Markdown' });
                return res.status(400).send('Verification Failed');
            }
            
            // پاسخ به کاربر وب
            return res.status(400).send(`
                <h1>تأیید پرداخت ناموفق</h1>
                <p>متأسفانه، در تأیید نهایی پرداخت شما خطایی رخ داد.</p>
                <p>شماره پیگیری: <strong>${Authority}</strong></p>
                <p>کد خطا: ${errorCode}</p>
                <p>لطفاً با پشتیبانی (@AyVPNsupport) تماس بگیرید.</p>
            `);
        }
    } catch (error) {
        console.error('Vercel Function Error:', error.message);
        if (isTelegram) await bot.sendMessage(chat_id, '❌ در پردازش پرداخت شما خطایی رخ داد. لطفاً با پشتیبانی (@AyVPNsupport) تماس بگیرید.');
        return res.status(500).send(`<h1>خطا در سرور</h1><p>${error.message}</p>`);
    }
};

// تابع generateSuccessPage در انتهای فایل اصلی verify.js
function generateSuccessPage(details) {
    const { trackingId, userLink, previousPurchases, name, requestedUsers } = details;
    
    let previousPurchasesHtml = '';
    if (previousPurchases && previousPurchases.length > 0) {
        previousPurchasesHtml = `
            <div class="previous-purchases">
                <h3>📜 سابقه خریدهای شما</h3>
                <ul>
                    ${previousPurchases.map(p => `
                        <li>
                            <span class="plan-badge">${p.plan}</span>
                            <span class="date">${new Date(p.purchaseDate).toLocaleDateString('fa-IR')}</span>
                            <code class="link">${p.link}</code>
                            <span class="track-id">پیگیری: ${p.trackingId}</span>
                            <span class="status-badge">${p.expiryDate === 'نامشخص' || new Date(p.expiryDate) > new Date() ? 'فعال' : 'منقضی شده'}</span>
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
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-20px); } to { transform: translateY(0); } }
        .icon { font-size: 4rem; color: var(--success-color); animation: pop 0.5s ease-out; }
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
        .previous-purchases li { background: #f8f9fa; padding: 10px 15px; border-radius: 8px; margin-bottom: 10px; font-size: 0.9rem; position: relative; }
        .plan-badge { background: #007bff; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8rem; margin-left: 10px; }
        .status-badge { position: absolute; left: 15px; top: 10px; font-size: 0.8rem; padding: 2px 8px; border-radius: 12px; background: #28a745; color: white; }
        .date { opacity: 0.8; } .link { display: block; margin-top: 5px; } .track-id { display: block; font-size: 0.8rem; opacity: 0.7; margin-top: 5px; }
        .footer-nav { margin-top: 30px; } .footer-nav a { color: #777; text-decoration: none; margin: 0 10px; font-size: 0.9rem; }
    </style></head><body><div class="container">
        <div class="icon">🎉</div><h1>پرداخت موفقیت‌آمیز بود!</h1>
        <p>${name ? `کاربر گرامی ${name}،` : ''} لینک اشتراک شما آماده است.</p>
        <p style="font-size:0.9rem; color:#888;">شماره پیگیری شما: <strong>${trackingId}</strong></p>
        ${requestedUsers && requestedUsers > 1 ? `<p style="font-size:1rem; color:#444; font-weight: bold;">تعداد کاربران: ${requestedUsers} نفر</p>` : ''}
        <div class="subscription-box"><code class="subscription-link" id="subLink">${userLink}</code>
            <div class="actions">
                <button id="copyBtn" title="کپی لینک"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"></path></svg></button>
                <button id="openBtn" title="باز کردن لینک"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h11c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"></path></svg></button>
            </div>
        </div>
        
        ${previousPurchasesHtml}

        <div class="footer-nav">
            <a href="https://t.me/AyVPNsupport" target="_blank">پشتیبانی</a> | <a href="/">صفحه اصلی</a>
        </div>
    </div>
    <script>
        document.getElementById('copyBtn').addEventListener('click', () => {
            const link = document.getElementById('subLink').innerText;
            navigator.clipboard.writeText(link).then(() => {
                alert('لینک اشتراک با موفقیت کپی شد!');
            });
        });
        document.getElementById('openBtn').addEventListener('click', () => {
            const link = document.getElementById('subLink').innerText;
            window.open(link, '_blank');
        });
    </script>
    </body></html>
    `;
}