const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const fetch = require('node-fetch');
const TelegramBot = require('node-telegram-bot-api');

// --- متغیرهای محیطی ---
const ZARINPAL_MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = '5976170456'; // آیدی ادمین

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

const RENEW_SHEET_TITLE = 'Renew';
const COUPON_SHEET_TITLE = 'Coupen';

// --- تابع کمکی برای اتصال به گوگل شیت ---
async function getDoc() {
    const serviceAccountAuth = new JWT({
        email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    return doc;
}

// --- تابع کمکی برای نمایش قیمت به تومان ---
function formatPrice(price) {
    if (typeof price !== 'number' || isNaN(price)) return '0';
    return price.toLocaleString('fa-IR') + ' تومان';
}

// --- تابع ساخت صفحه HTML موفقیت ---
function generateSuccessPage(details) {
    const { trackingId, userLink, name, requestedUsers, isRenewal, renewalIdentifier } = details;

    if (isRenewal) {
        return `
        <!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><title>درخواست تمدید ثبت شد</title><style>body{font-family: Vazirmatn, sans-serif; background: #f0f2f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; text-align: center;} .container{background: #fff; padding: 40px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); max-width: 500px;} h1{color: #007bff;} code{display: block; background: #f8f9fa; padding: 10px; border-radius: 5px; margin: 10px 0;}</style></head><body><div class="container">
            <h1>📝 درخواست تمدید شما ثبت شد!</h1>
            <p>درخواست شما با موفقیت ثبت گردید و به زودی توسط تیم پشتیبانی بررسی خواهد شد.</p>
            <p><strong>شناسه/لینک وارد شده:</strong> <code>${renewalIdentifier}</code></p>
            <p><strong>شماره پیگیری پرداخت:</strong> <strong>${trackingId}</strong></p>
            <p style="color: #28a745; font-weight: bold;">نتیجه تمدید و فعالسازی مجدد اشتراک شما اطلاع‌رسانی خواهد شد.</p>
        </div></body></html>`;
    }

    return `
    <!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><title>پرداخت موفق</title><style>body{font-family: Vazirmatn, sans-serif; background: #f0f2f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; text-align: center;} .container{background: #fff; padding: 40px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); max-width: 500px;} h1{color: #28a745;} code{display: block; background: #f8f9fa; padding: 15px; border-radius: 5px; margin-top: 20px; font-size: 1.1rem; word-break: break-all; cursor: copy;}</style></head><body><div class="container">
        <h1>🎉 پرداخت موفقیت‌آمیز بود!</h1>
        <p>${name ? `کاربر گرامی ${name}،` : ''} لینک اشتراک شما آماده است.</p>
        <p><strong>تعداد کاربران:</strong> ${requestedUsers} نفر</p>
        <p><strong>شماره پیگیری شما:</strong> ${trackingId}</p>
        <p>برای کپی، روی لینک زیر کلیک کنید:</p>
        <code id="subLink" title="برای کپی کلیک کنید">${userLink}</code>
    </div>
    <script>
        document.getElementById('subLink').addEventListener('click', () => {
            navigator.clipboard.writeText('${userLink}').then(() => alert('لینک با موفقیت کپی شد!'));
        });
    </script>
    </body></html>`;
}


// --- تابع اصلی API ---
module.exports = async (req, res) => {
    const { Authority, Status, amount, chat_id, name, email, phone, renewalIdentifier, requestedPlan, coupenCode, telegramUsername, telegramId, users, description } = req.query;
    
    // --- تبدیل مبلغ ---
    const amountToman = Number(amount); 
    const amountRial = amountToman * 10; // مبلغ نهایی به ریال (برای فراخوانی زرین‌پال)
    // ---
    
    const isTelegram = chat_id && chat_id !== 'none';
    const isRenewal = renewalIdentifier && renewalIdentifier.length > 0;
    
    if (Status !== 'OK') {
        if (isTelegram) await bot.sendMessage(chat_id, '❌ پرداخت ناموفق بود. لطفاً دوباره تلاش کنید.');
        return res.status(400).send(`<h1>پرداخت ناموفق</h1><p>کد پیگیری: ${Authority}.</p>`);
    }

    try {
        // --- فراخوانی زرین‌پال با مبلغ ریالی ---
        const verificationResponse = await fetch('https://api.zarinpal.com/pg/v4/payment/verify.json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ merchant_id: ZARINPAL_MERCHANT_ID, amount: amountRial, authority: Authority }),
        });
        
        const verificationResult = await verificationResponse.json();
        
        // **جدید**: لاگ کردن پاسخ کامل زرین‌پال در صورت خطا برای عیب‌یابی نهایی
        if (verificationResult.errors.length > 0 || verificationResult.data.code !== 100) {
            console.error('ZarinPal Verification Error JSON:', JSON.stringify(verificationResult, null, 2));
        }

        if (verificationResult.errors.length > 0 || verificationResult.data.code !== 100) {
            const errorSource = verificationResult.errors[0] || verificationResult.data;
            // تلاش برای استخراج پیغام خطا یا نمایش کد خطا
            const errorMsg = errorSource.message || `کد خطا: ${errorSource.code || 'نامشخص'}`;
            
            throw new Error(`تایید پرداخت ناموفق بود: ${errorMsg}`);
        }

        const trackingId = verificationResult.data.ref_id.toString();
        const doc = await getDoc();

        // --- منطق کوپن ---
        let discountAmount = 0;
        let couponRowToUpdate = null;
        if (coupenCode) {
            const couponSheet = doc.sheetsByTitle[COUPON_SHEET_TITLE];
            if (couponSheet) {
                await couponSheet.loadHeaderRow(1);
                const rows = await couponSheet.getRows();
                const couponRow = rows.find(row => row.get('coupen') && row.get('coupen').toLowerCase() === coupenCode.toLowerCase());
                
                if (couponRow) {
                     const percent = parseInt(couponRow.get('percent')) || 0;
                     const price = parseInt(couponRow.get('price')) || 0;
                     
                     if(percent > 0) {
                        const originalAmount = Math.round(amountToman / (1 - percent / 100));
                        discountAmount = originalAmount - amountToman;
                     } else if (price > 0) {
                        discountAmount = price;
                     }
                     couponRowToUpdate = couponRow;
                }
            }
        }

        let currentLink = '';
        const today = new Date().toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' });

        if (isRenewal) {
            // --- منطق تمدید ---
            const renewSheet = doc.sheetsByTitle[RENEW_SHEET_TITLE];
            if (!renewSheet) throw new Error(`شیت '${RENEW_SHEET_TITLE}' یافت نشد.`);
            
            await renewSheet.addRow({
                renewalIdentifier: renewalIdentifier,
                requestedPlan: requestedPlan,
                name: name,
                email: email,
                phone: phone,
                telegramUsername: telegramUsername,
                chat_id: isTelegram ? chat_id : '',
                telegramId: telegramId,
                requestDate: today,
                users: users,
                description: description,
                amount: amountToman, // مبلغ به تومان برای ثبت در شیت
                coupenCode: coupenCode || '',
                discountAmount: discountAmount,
                trackingId: trackingId,
            });

            const adminMessage = `🚨 درخواست تمدید جدید 🚨\nشناسه: \`${renewalIdentifier}\`\nپلن: ${requestedPlan} | کاربران: ${users}\nمبلغ: ${formatPrice(amountToman)}\nپیگیری: ${trackingId}`;
            await bot.sendMessage(ADMIN_CHAT_ID, adminMessage, { parse_mode: 'Markdown' });

        } else {
            // --- منطق خرید جدید ---
            const sheet = doc.sheetsByTitle[requestedPlan];
            if (!sheet) throw new Error(`شیت پلن '${requestedPlan}' یافت نشد.`);
            
            await sheet.loadHeaderRow(1);
            const rows = await sheet.getRows();
            const availableRow = rows.find(row => !row.get('status') || row.get('status').toLowerCase() !== 'used');

            if (!availableRow) {
                const errorMsg = `❌ تمام لینک‌های پلن ${requestedPlan} فروخته شده‌اند.`;
                await bot.sendMessage(ADMIN_CHAT_ID, errorMsg);
                throw new Error('متاسفانه ظرفیت این پلن تکمیل شده است. لطفاً با پشتیبانی تماس بگیرید.');
            }

            currentLink = availableRow.get('link');
            availableRow.set('status', 'used');
            availableRow.set('trackingId', trackingId);
            availableRow.set('purchaseDate', today);
            availableRow.set('name', name);
            availableRow.set('email', email);
            availableRow.set('chat_id', isTelegram ? chat_id : '');
            availableRow.set('phone', phone);
            availableRow.set('coupen', coupenCode ? `${coupenCode} (-${discountAmount})` : '');
            availableRow.set('users', users);
            availableRow.set('renewalCount', 0); // مقدار اولیه
            await availableRow.save();

            const adminMessage = `🛍️ خرید جدید 🛍️\nپلن: ${requestedPlan} | کاربران: ${users}\nمبلغ: ${formatPrice(amountToman)}\nلینک: \`${currentLink}\`\nپیگیری: ${trackingId}`;
            await bot.sendMessage(ADMIN_CHAT_ID, adminMessage, { parse_mode: 'Markdown' });
        }

        // --- به‌روزرسانی کوپن ---
        if (couponRowToUpdate) {
            const manyTimes = couponRowToUpdate.get('manyTimes');
            if (manyTimes && manyTimes !== 'unlimited') {
                const remaining = parseInt(manyTimes, 10) - 1;
                if (remaining >= 0) {
                    couponRowToUpdate.set('manyTimes', remaining.toString());
                    await couponRowToUpdate.save();
                }
            }
        }
        
        // --- پاسخ به کاربر ---
        if (isTelegram) {
            const message = isRenewal
                ? `📝 درخواست تمدید شما با موفقیت ثبت شد!\nشماره پیگیری: **${trackingId}**\n\nبه زودی توسط پشتیبانی بررسی خواهد شد.`
                : `🎉 پرداخت موفق!\nشماره پیگیری: **${trackingId}**\nتعداد کاربران: **${users}**\n\nلینک اشتراک شما:\n\`${currentLink}\``;
            await bot.sendMessage(chat_id, message, { parse_mode: 'Markdown' });
            return res.status(200).send('OK');
        } else {
            const pageHtml = generateSuccessPage({
                trackingId,
                userLink: currentLink,
                name,
                requestedUsers: users,
                isRenewal,
                renewalIdentifier,
            });
            return res.status(200).send(pageHtml);
        }

    } catch (error) {
        console.error('Verify API Error:', error.message);
        const adminMsg = `⚠️ خطای سرور در Verify ⚠️\nAuthority: ${Authority}\nError: ${error.message}`;
        await bot.sendMessage(ADMIN_CHAT_ID, adminMsg);
        if (isTelegram) await bot.sendMessage(chat_id, `❌ خطای سرور: ${error.message}. لطفاً با پشتیبانی تماس بگیرید.`);
        return res.status(500).send(`<h1>خطای سرور</h1><p>${error.message}</p>`);
    }
};
