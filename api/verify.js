const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const fetch = require('node-fetch');
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');

// --- متغیرهای محیطی شما (این متغیرها باید همچنان در سرویس شما تنظیم شده باشند) ---
const ZARINPAL_MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || 'YOUR_ADMIN_CHAT_ID'; // Ensure this is set

// --- متغیرهای جدید X-UI (با اطلاعات وارد شده توسط شما) ---
const XUI_PANEL_URL = 'https://org.shammay.ir:1101'; 
const XUI_USERNAME = 'ayvpn';
const XUI_PASSWORD = 'M0H4MM4DLI';
const XUI_INBOUND_ID = '87'; 

// --- مشخصات کانفیگ VLESS بر اساس نمونه شما ---
const VLESS_SERVER_ADDRESS = 'org.shammay.ir';
const VLESS_SERVER_PORT = '22507';
const VLESS_TRANSPORT_TYPE = 'tcp';
const VLESS_SECURITY_TYPE = 'none';

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

// CRITICAL FIX: Corrected Toman values and added sheet titles
const planToSheetMap = {
    '120000': '30D', '220000': '60D', '340000': '90D',
    '600000': '180D', '1000000': '365D', '2000000': '730D',
};

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

// --- توابع مدیریت کوپن ---
async function checkAndApplyCoupon(requestedAmount, couponCode) {
    if (!couponCode) return { discountPercentage: 0 };
    
    const doc = await getOrCreateDoc();
    const sheet = doc.sheetsByTitle['Coupons'];
    if (!sheet) {
        throw new Error('Coupon sheet not found.');
    }

    const rows = await sheet.getRows();
    const couponRow = rows.find(row => row.get('code').toLowerCase() === couponCode.toLowerCase());

    if (couponRow) {
        const expiryDate = couponRow.get('expiryDate');
        const manyTimes = Number(couponRow.get('manyTimes'));
        const price = Number(couponRow.get('price'));
        const type = couponRow.get('type');
        const value = Number(couponRow.get('value'));
        
        if (expiryDate && new Date(expiryDate) < new Date()) {
            return { error: 'Coupon expired' };
        }
        if (type === 'percent' && manyTimes === 0) {
            return { error: 'Coupon usage limit reached' };
        }
        if (type === 'price' && price <= 0) {
            return { error: 'Coupon balance is zero' };
        }
        
        let discountPercentage = 0;
        if (type === 'percent') {
            discountPercentage = value;
        } else if (type === 'price') {
            const discountAmount = Math.min(value, requestedAmount);
            discountPercentage = (discountAmount / requestedAmount) * 100;
        }

        if (discountPercentage === 0) {
             return { error: 'Coupon applied but resulted in zero discount.' };
        }

        return { discountPercentage: discountPercentage };
        
    } else {
        return { error: 'Invalid coupon code' };
    }
}

async function decreaseCouponUsage(couponCode, finalAmount) {
    const doc = await getOrCreateDoc();
    const sheet = doc.sheetsByTitle['Coupons']; 
    if (!sheet) {
        console.error('Coupon Sheet not found for usage decrease!');
        return;
    }

    const rows = await sheet.getRows();
    const couponRow = rows.find(row => row.get('code').toLowerCase() === couponCode.toLowerCase());

    if (couponRow) {
        const type = couponRow.get('type');

        if (type === 'percent') {
            let manyTimes = Number(couponRow.get('manyTimes'));
            if (manyTimes > 0) {
                couponRow.set('manyTimes', manyTimes - 1);
                await couponRow.save();
            }
        } else if (type === 'price') {
             // Logic for price coupon deduction simplified (deducts full fixed value once)
            const value = Number(couponRow.get('value'));
            let currentPrice = Number(couponRow.get('price'));
            if (currentPrice > 0) {
                const newPrice = currentPrice - value;
                couponRow.set('price', newPrice < 0 ? 0 : newPrice);
                await couponRow.save();
            }
        }
    }
}


// --- توابع X-UI ---

// Function to convert duration title (e.g., '30D') to expiry timestamp (ms)
function getExpiryTime(durationTitle) {
    const now = Date.now();
    let days = 0;
    switch (durationTitle) {
        case '30D': days = 30; break;
        case '60D': days = 60; break;
        case '90D': days = 90; break;
        case '180D': days = 180; break;
        case '365D': days = 365; break;
        case '730D': days = 730; break;
        default: return 0; // 0 means unlimited/no expiry
    }
    // X-UI expiryTime is a timestamp in milliseconds
    return now + (days * 24 * 60 * 60 * 1000);
}

// New: X-UI Login and Client Creation Logic
async function createXuiClient(trackingId, sheetTitle, userCount) {
    
    // --- 1. Login to X-UI Panel ---
    const loginUrl = `${XUI_PANEL_URL}/login`;
    const loginResponse = await fetch(loginUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=${XUI_USERNAME}&password=${XUI_PASSWORD}`
    });

    if (!loginResponse.headers.has('set-cookie')) {
        throw new Error('X-UI login failed or did not return a session cookie. Check URL, Username, and Password.');
    }
    const sessionCookie = loginResponse.headers.get('set-cookie').split(';')[0];
    
    // --- 2. Create Client ---
    // NOTE: The X-UI API path for adding a client must be correct for your version of X-UI/Panel.
    // The following path is common:
    const addClientUrl = `${XUI_PANEL_URL}/panel/api/inbounds/addClient`; 
    const expiryTime = getExpiryTime(sheetTitle);
    
    // UUID for the new client (must be generated here)
    const clientUuid = uuidv4(); 

    // Email/Remark for X-UI
    const clientRemark = `${trackingId}_${userCount}U_${sheetTitle}`; 

    // Client settings for X-UI 
    const clientSettings = {
        id: clientUuid,
        email: clientRemark, // Unique identifier and remark
        flow: '', // Empty flow for TCP
        limitIp: userCount, // Max concurrent connections (userCount)
        total: 0, // 0 for unlimited traffic
        expiryTime: expiryTime, // Calculated timestamp in milliseconds
        tgid: '',
        subId: ''
    };

    // Main API payload
    const payload = {
        id: Number(XUI_INBOUND_ID), // The Inbound ID the client will be added to
        settings: JSON.stringify(clientSettings)
    };
    
    const clientResponse = await fetch(addClientUrl, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Cookie': sessionCookie
        },
        body: JSON.stringify(payload)
    });
    const clientResult = await clientResponse.json();

    if (clientResult.success !== true) {
        throw new Error(`X-UI client creation failed: ${clientResult.msg || 'Unknown error'}. Check Inbound ID.`);
    }

    // --- 3. Get Subscription Link (VLESS/TCP/None) ---
    // Constructed based on the user's provided sample configuration.
    
    const userLink = `vless://${clientUuid}@${VLESS_SERVER_ADDRESS}:${VLESS_SERVER_PORT}?type=${VLESS_TRANSPORT_TYPE}&security=${VLESS_SECURITY_TYPE}&flow=${clientSettings.flow}&remark=${encodeURIComponent(clientRemark)}`;

    return userLink;
}

// --- تابع اصلی ---
module.exports = async (req, res) => {
    const { action } = req.query;

    if (req.method === 'POST' && action === 'check_coupon') {
        try {
            const { couponCode, requestedAmount } = req.body;
            const result = await checkAndApplyCoupon(requestedAmount, couponCode);
            
            if (result.error) {
                return res.status(400).json(result);
            }
            return res.status(200).json(result);
        } catch (error) {
            console.error('Coupon Check Error:', error.message);
            return res.status(500).json({ error: 'Internal Server Error during coupon check.' });
        }
    }


    if (req.method === 'GET' && req.query.authority && req.query.Status) {
        const { authority, Status, amount, chat_id, name, email, phone, renewalIdentifier, requestedPlan, couponCode, userCount } = req.query; 

        const trackingId = uuidv4();

        if (Status !== 'OK') {
            const htmlContent = `
                <style>body{font-family:'Vazirmatn',sans-serif;direction:rtl;text-align:center;background-color:#f8f9fa;padding:20px}h2{color:#dc3545}p{color:#6c757d}.container{max-width:500px;margin:50px auto;background:#fff;padding:30px;border-radius:10px;box-shadow:0 0 10px rgba(0,0,0,.1)}</style>
                <div class="container">
                    <h2>❌ تراکنش ناموفق</h2>
                    <p>عملیات پرداخت تکمیل نشد یا توسط کاربر لغو گردید.</p>
                    <p>در صورت کسر وجه، مبلغ ظرف مدت کوتاهی به حساب شما بازخواهد گشت.</p>
                </div>
            `;
            res.status(200).send(htmlContent);

            if (chat_id && chat_id !== 'none') {
                bot.sendMessage(chat_id, '❌ متاسفانه تراکنش ناموفق بود یا لغو شد. لطفاً دوباره تلاش کنید: /start');
            }
            return;
        }

        // 1. تأیید پرداخت
        try {
            // CRITICAL FIX: Convert Toman to Rial for Zarinpal verification (* 10)
            const finalAmountToVerify = Number(amount) * 10; 
            
            const verifyResponse = await fetch('https://api.zarinpal.com/pg/v4/payment/verify.json', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    merchant_id: ZARINPAL_MERCHANT_ID,
                    amount: finalAmountToVerify,
                    authority: authority,
                }),
            });
            const verifyResult = await verifyResponse.json();
            const data = verifyResult.data;

            if (verifyResult.errors.length > 0 || data.code !== 100) {
                throw new Error(`Zarinpal verification failed with code: ${data.code || verifyResult.errors.code}`);
            }

            // --- 2. تولید لینک با X-UI (منطق جدید) ---
            const sheetTitle = planToSheetMap[requestedPlan]; 
            const finalUserCount = Number(userCount) || 1;

            const userLink = await createXuiClient(trackingId, sheetTitle, finalUserCount); 

            // --- 3. ثبت سفارش در Google Sheet ---
            const doc = await getOrCreateDoc();
            const sheet = doc.sheetsByTitle[sheetTitle];

            if (!sheet) {
                throw new Error(`Sheet not found for plan: ${requestedPlan}`);
            }
            
            await sheet.addRow({
                trackingId: trackingId,
                amountPaid: amount,
                plan: requestedPlan,
                duration: sheetTitle,
                name: name || 'N/A',
                email: email || 'N/A',
                phone: phone || 'N/A',
                link: userLink,
                userCount: finalUserCount,
                purchaseDate: new Date().toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' }),
                renewalIdentifier: renewalIdentifier || 'N/A',
                couponCode: couponCode || 'N/A',
            });

            // 4. کاهش موجودی کوپن
            if (couponCode && couponCode.toLowerCase() !== 'none' && couponCode !== '') {
                await decreaseCouponUsage(couponCode, amount);
            }

            // 5. ارسال لینک و اطلاعات به کاربر (تلگرام)
            if (chat_id && chat_id !== 'none') {
                const successMsg = `✅ **پرداخت شما با موفقیت تأیید شد.**\n\n**پلن:** ${sheetTitle} (${finalUserCount} کاربره)\n**مبلغ پرداختی:** ${Number(amount).toLocaleString('fa-IR')} تومان\n**شناسه پیگیری:** \`${trackingId}\`\n\n**لینک اشتراک:**\n\`${userLink}\`\n\nلطفاً لینک را کپی کرده و در برنامه خود استفاده کنید. برای راهنمایی بیشتر به منو برگردید: /start`;

                await bot.sendMessage(chat_id, successMsg, { parse_mode: 'Markdown' });
                
                // ارسال اعلان به ادمین
                await bot.sendMessage(ADMIN_CHAT_ID, `🔔 **خرید جدید**\n\n**پلن:** ${sheetTitle} (${finalUserCount} کاربره)\n**مبلغ:** ${Number(amount).toLocaleString('fa-IR')} تومان\n**لینک:** ${userLink}\n**کاربر:** ${name || 'N/A'}`);
            }
            
            // 6. نمایش صفحه موفقیت (وب)
            const htmlContent = `
                <!DOCTYPE html>
                <html lang="fa" dir="rtl">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>تراکنش موفق</title>
                    <style>
                        @font-face {font-family: 'Vazirmatn'; src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Regular.woff2') format('woff2');}
                        body{font-family:'Vazirmatn',sans-serif;direction:rtl;text-align:center;background-color:#f8f9fa;padding:20px;color:#333}
                        .container{max-width:500px;margin:50px auto;background:#fff;padding:30px;border-radius:10px;box-shadow:0 0 10px rgba(0,0,0,.1)}
                        h2{color:#28a745;margin-bottom:20px;}
                        p{color:#6c757d;font-size:16px;}
                        .subscription-box{margin-top:20px;padding:15px;background-color:#e9f7ef;border:1px dashed #28a745;border-radius:5px;}
                        .subscription-link{word-break:break-all;text-align:left;display:block;font-size:14px;font-family:monospace;margin-bottom:10px;padding:5px;background:#fff;}
                        .actions button{background-color:#007bff;color:white;border:none;padding:10px 15px;margin:5px;border-radius:5px;cursor:pointer;font-family:'Vazirmatn',sans-serif;}
                        .actions button:hover{background-color:#0056b3;}
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h2>✅ تراکنش موفق</h2>
                        <p>پرداخت شما با موفقیت انجام و لینک اشتراک شما صادر گردید.</p>
                        <p>شناسه پیگیری شما: <strong>${trackingId}</strong></p>
                        <div class="subscription-box"><code class="subscription-link" id="subLink">${userLink}</code>
                            <div class="actions">
                                <button id="copyBtn" title="کپی لینک">کپی لینک</button>
                                <button id="openBtn" title="باز کردن لینک">باز کردن لینک</button>
                            </div>
                        </div>
                        <p style="margin-top: 15px; font-size: 14px;">لینک اشتراک همچنین به ربات تلگرام شما ارسال شد.</p>

                        <script>
                            document.getElementById('copyBtn').addEventListener('click', function() {
                                const link = document.getElementById('subLink').innerText;
                                navigator.clipboard.writeText(link).then(function() {
                                    alert('لینک با موفقیت کپی شد!');
                                }, function(err) {
                                    console.error('Could not copy text: ', err);
                                    alert('خطا در کپی لینک.');
                                });
                            });
                            document.getElementById('openBtn').addEventListener('click', function() {
                                const link = document.getElementById('subLink').innerText;
                                window.open(link, '_blank');
                            });
                        </script>
                    </div>
                </body>
                </html>
            `;
            res.status(200).send(htmlContent);

        } catch (error) {
            console.error('Verification/Save Error:', error.message);
            const htmlContent = `
                <style>body{font-family:'Vazirmatn',sans-serif;direction:rtl;text-align:center;background-color:#f8f9fa;padding:20px}h2{color:#ffc107}p{color:#6c757d}.container{max-width:500px;margin:50px auto;background:#fff;padding:30px;border-radius:10px;box-shadow:0 0 10px rgba(0,0,0,.1)}</style>
                <div class="container">
                    <h2>⚠️ خطا در تأیید نهایی</h2>
                    <p>تراکنش شما موفقیت‌آمیز بوده اما خطایی در ثبت سفارش یا صدور لینک رخ داده است.</p>
                    <p>لطفاً این موضوع را با پشتیبانی در میان بگذارید. کد پیگیری زرین‌پال: ${authority}</p>
                </div>
            `;
            res.status(200).send(htmlContent);

            if (chat_id && chat_id !== 'none') {
                 bot.sendMessage(chat_id, `⚠️ **خطا در تأیید نهایی**: تراکنش شما انجام شده اما خطایی در ثبت سفارش رخ داده است. لطفاً کد پیگیری زرین‌پال خود را به پشتیبانی ارائه دهید: ${authority}`);
            }
            bot.sendMessage(ADMIN_CHAT_ID, `🚨 **خطای بحرانی در ثبت سفارش**\nAuthority: ${authority}\nAmount: ${amount}\nError: ${error.message}`);
        }
    } else {
        return res.status(400).send('Invalid request or missing parameters.');
    }
};
