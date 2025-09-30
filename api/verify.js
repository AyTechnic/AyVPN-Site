const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const fetch = require('node-fetch');
const TelegramBot = require('node-telegram-bot-api');

// --- متغیرهای محیطی و کانفیگ شما ---
const ZARINPAL_MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = '5976170456'; // لطفا این شناسه را با شناسه مدیر واقعی جایگزین کنید

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

// --- نگاشت‌های فیکس شده برای تعیین شیت مقصد ---

// نگاشت قدیمی بر اساس مبلغ: فقط برای توابع جستجوی تاریخچه (به دلیل ساختار داده موجود)
const planToSheetMap = {
    '120000': '30D', '220000': '60D', '340000': '90D', // توجه: قیمت‌های ۱ کاربره را اینجا نگه دارید
    '600000': '180D', '1000000': '365D', '2000000': '730D',
};

// **FIX:** نگاشت جدید بر اساس requestedPlan (که از URL دریافت می‌شود)
// این نگاشت، تعیین کننده شیت نهایی برای ثبت خرید جدید یا تمدید است.
const planRequestToSheetMap = {
    '1M': '30D', '2M': '60D', '3M': '90D',
    '6M': '180D', '1Y': '365D', '2Y': '730D',
    // فرض بر این است که پلن‌های ملی (1M-N, 3M-N) از همان شیت‌های استاندارد استفاده می‌کنند.
    '1M-N': '30D', 
    '3M-N': '90D', 
};

// نگاشت مدت زمان پلن (برای محاسبه تاریخ انقضا و تمدید)
const planDurationDays = {
    '1M': 30, '2M': 60, '3M': 90,
    '6M': 180, '1Y': 365, '2Y': 730,
    '1M-N': 30,
    '3M-N': 90,
};

const RENEW_SHEET_TITLE = 'Renew'; 
const COUPON_SHEET_TITLE = 'Coupen';

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

/**
 * **FIX:** به‌روزرسانی موجودی کوپن پس از خرید موفق
 * @param {GoogleSpreadsheet} doc
 * @param {object} appliedCoupon - شامل row و اطلاعات کوپن
 */
async function updateCouponUsage(appliedCoupon) {
    if (!appliedCoupon || !appliedCoupon.originalRow) return;

    const couponRow = appliedCoupon.originalRow;

    if (couponRow.get('manyTimes') && couponRow.get('manyTimes') !== 'Unlimited') {
        let manyTimes = couponRow.get('manyTimes');
        let usedCount = 0;
        
        if (manyTimes.includes('(')) {
            // حالت '3(2)' که 3 کل استفاده و 2 باقی مانده است
            const parts = manyTimes.match(/(\d+)\((\d+)\)/);
            if (parts) {
                const total = parseInt(parts[1]);
                const remaining = parseInt(parts[2]);
                usedCount = remaining - 1;
                couponRow.set('manyTimes', `${total}(${Math.max(0, usedCount)})`);
            }
        } else {
            // حالت '3' که 3 باقی مانده است
            usedCount = parseInt(manyTimes) - 1;
            couponRow.set('manyTimes', Math.max(0, usedCount).toString());
        }
    }
    
    // اگر کوپن بر اساس مبلغ باشد، موجودی مبلغ آن را کاهش می‌دهیم
    if (appliedCoupon.type === 'price' && couponRow.get('price') && couponRow.get('price').includes('(')) {
        const priceStr = couponRow.get('price');
        const parts = priceStr.match(/(\d+)\s*\((.*)\)/); // مثال: 100000(موجودی)
        if (parts) {
            const remainingBalance = parseInt(parts[1]);
            const note = parts[2];
            const newBalance = remainingBalance - appliedCoupon.discount;
            couponRow.set('price', `${Math.max(0, newBalance)}`); // حذف Note برای سادگی
        }
    }

    await couponRow.save();
}

/**
 * **NEW:** پیدا کردن خرید اصلی و به‌روزرسانی تاریخ انقضا برای تمدید
 * @param {GoogleSpreadsheet} doc
 * @param {string} renewalIdentifier - trackingId خرید اصلی
 * @param {string} requestedPlan - پلن تمدید (مثلاً '1M')
 * @param {string} purchaseDate - تاریخ امروز/خرید
 */
async function renewSubscription(doc, renewalIdentifier, requestedPlan, purchaseDate) {
    const durationDays = planDurationDays[requestedPlan];
    if (!durationDays) {
        throw new Error(`Invalid requestedPlan for renewal: ${requestedPlan}`);
    }

    let originalRow = null;
    let originalSheetTitle = null;
    
    // جستجو در تمام شیت‌های پلن (به جز Renew و Coupen) برای یافتن شناسه خرید اصلی
    const planSheets = Object.values(planRequestToSheetMap).filter((v, i, a) => a.indexOf(v) === i); 
    
    for (const sheetTitle of planSheets) {
        const sheet = doc.sheetsByTitle[sheetTitle];
        if (sheet) {
            await sheet.loadHeaderRow(1); 
            const rows = await sheet.getRows();
            originalRow = rows.find(row => row.get('trackingId') === renewalIdentifier); 
            
            if (originalRow) {
                originalSheetTitle = sheetTitle;
                break;
            }
        }
    }
    
    if (!originalRow) {
        throw new Error(`Original purchase (ID: ${renewalIdentifier}) not found for renewal.`);
    }
    
    // 2. محاسبه تاریخ انقضای جدید
    const currentExpiryStr = originalRow.get('expiryDate');
    let baseDate = new Date(purchaseDate); 
    
    if (currentExpiryStr) {
        // تبدیل تاریخ انقضای شمسی/میلادی به آبجکت Date
        // فرض می‌کنیم فرمت DD/MM/YYYY میلادی است (در این مثال).
        const parts = currentExpiryStr.match(/(\d+)\/(\d+)\/(\d+)/);
        const currentExpiry = parts ? new Date(`${parts[2]}/${parts[1]}/${parts[3]}`) : new Date(currentExpiryStr);
        
        const today = new Date(purchaseDate);
        today.setHours(0, 0, 0, 0);

        if (currentExpiry > today) {
            // اگر اشتراک هنوز فعال است، تمدید از تاریخ انقضای فعلی شروع می‌شود
            baseDate = currentExpiry;
        }
    }

    // اضافه کردن مدت زمان تمدید
    baseDate.setDate(baseDate.getDate() + durationDays);
    
    // فرمت تاریخ انقضای جدید (به فرمت DD/MM/YYYY میلادی)
    const newExpiryDate = `${baseDate.getDate().toString().padStart(2, '0')}/${(baseDate.getMonth() + 1).toString().padStart(2, '0')}/${baseDate.getFullYear()}`;

    // 3. به‌روزرسانی ردیف اصلی
    originalRow.set('expiryDate', newExpiryDate);
    originalRow.set('status', 'used'); 
    originalRow.set('lastRenewalDate', purchaseDate);
    originalRow.set('renewalCount', (parseInt(originalRow.get('renewalCount') || '0') + 1).toString());
    
    await originalRow.save();

    return {
        newExpiryDate,
        originalLink: originalRow.get('link'),
        originalSheetTitle
    };
}


// --- تابع checkAndApplyCoupon (تغییرات جزئی برای سادگی) ---
async function checkAndApplyCoupon(doc, couponCode, amount) {
    if (!couponCode) return { finalAmount: amount, appliedCoupon: null, error: null };
    
    try {
        const couponSheet = doc.sheetsByTitle[COUPON_SHEET_TITLE];
        if (!couponSheet) throw new Error('شیت Coupen یافت نشد. لطفاً شیت را ایجاد کنید.');

        await couponSheet.loadHeaderRow(1);
        const rows = await couponSheet.getRows();
        const couponRow = rows.find(row => row.get('Coupen') === couponCode);

        if (!couponRow) {
            return { finalAmount: amount, appliedCoupon: null, error: `کد تخفیف ${couponCode} نامعتبر است.` };
        }
        // ... (بخش بررسی محدودیت‌ها و محاسبه تخفیف - همانند قبل) ...
        const percent = couponRow.get('percent');
        const price = couponRow.get('price');
        // ... (بقیه منطق محاسبه تخفیف) ...

        let discountAmount = 0;
        let finalAmount = amount;
        let type = 'percent';

        // 1. بررسی محدودیت‌ها
        // ... (منطق بررسی manyTimes و price) ...

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

// --- تابع findUserHistory (بدون تغییر) ---
async function findUserHistory(doc, chat_id) {
    // ... (همان منطق جستجوی قبلی) ...
    if (!chat_id || chat_id === 'none') return [];
    
    const allPurchases = [];
    const allSheetTitles = Object.values(planToSheetMap).concat([RENEW_SHEET_TITLE]); // شامل Renew

    for (const sheetTitle of allSheetTitles) {
        const sheet = doc.sheetsByTitle[sheetTitle];
        if (sheet) {
            await sheet.loadHeaderRow(1);
            const rows = await sheet.getRows();
            rows.forEach(row => {
                const rowChatId = row.get('chat_id');
                const identifierMatch = (chat_id === 'none' && (row.get('email') === chat_id || row.get('phone') === chat_id)) 
                                        || (chat_id !== 'none' && rowChatId && rowChatId.toString() === chat_id.toString());

                if (identifierMatch) {
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
    return allPurchases.sort((a, b) => new Date(b.purchaseDate) - new Date(a.purchaseDate));
}

// --- منطق اصلی (Handler) ---
module.exports = async (req, res) => {
    const {
        authority,
        Status,
        amount: expectedAmountStr, // مبلغ مورد انتظار
        chat_id,
        name,
        email,
        phone,
        renewalIdentifier, // شناسه تمدید (trackingId خرید قبلی)
        requestedPlan, // پلن درخواستی (مثلا 1M)
        coupenCode,
        telegramUsername,
        telegramId,
        users: usersStr, // تعداد کاربران
        description // توضیحات
    } = req.query;

    const expectedAmount = Number(expectedAmountStr);
    const users = parseInt(usersStr || '1');
    const purchaseDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });

    let finalPlanName = 'خرید موفق';
    let userLink = 'خطا در تولید لینک.';
    let isRenewalSuccess = false;
    let renewalResult = null;
    let finalSheetTitle = RENEW_SHEET_TITLE; // پیش فرض برای ثبت ردیف پرداخت

    try {
        if (Status !== 'OK') {
            return res.status(200).send(renderHTML('❌ پرداخت ناموفق', 'تراکنش توسط کاربر لغو یا ناموفق بود.', null, null, false));
        }

        const doc = await getOrCreateDoc();

        // 1. تایید پرداخت زرین‌پال
        const verifyResponse = await fetch('https://api.zarinpal.com/pg/v4/payment/verify.json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                merchant_id: ZARINPAL_MERCHANT_ID,
                amount: expectedAmount, // توجه: مبلغ باید همان مبلغ فرستاده شده باشد
                authority: authority,
            }),
        });
        const verifyResult = await verifyResponse.json();
        const verificationStatus = verifyResult.data.code;

        if (verificationStatus !== 100 && verificationStatus !== 101) {
            console.error('Zarinpal Verification Failed:', verificationStatus);
            return res.status(200).send(renderHTML('⚠️ خطای تایید پرداخت', `تراکنش ناموفق است. کد وضعیت: ${verificationStatus}.`, null, null, false));
        }

        const trackingId = verifyResult.data.ref_id.toString(); // RefID زرین‌پال به عنوان Tracking ID

        // 2. بررسی کوپن و به‌روزرسانی نهایی مبلغ
        let { finalAmount, appliedCoupon, error: couponError } = await checkAndApplyCoupon(doc, coupenCode, expectedAmount);
        
        // **FIX:** اگر مبلغ پرداخت شده توسط کاربر (amount) با مبلغ نهایی بعد از اعمال کوپن (finalAmount) مطابقت نداشت، خطا بده.
        // این چک حیاتی است تا تقلب یا خطای قیمت‌گذاری رخ ندهد.
        if (verifyResult.data.amount !== finalAmount) {
            await bot.sendMessage(ADMIN_CHAT_ID, `⚠️ خطای مبلغ در Verify: مبلغ تایید شده زرین‌پال (${verifyResult.data.amount}) با مبلغ نهایی محاسبه شده (${finalAmount}) مطابقت ندارد! (TID: ${trackingId})`);
            return res.status(200).send(renderHTML('⚠️ خطای امنیتی مبلغ', `مبلغ پرداخت شده با مبلغ مورد انتظار مطابقت ندارد. لطفا با پشتیبانی Ay Technic تماس بگیرید.`, null, null, false));
        }
        
        // 3. تعیین شیت مقصد اصلی و اجرای منطق تمدید/خرید جدید
        finalSheetTitle = planRequestToSheetMap[requestedPlan];

        if (renewalIdentifier && finalSheetTitle) {
            // منطق تمدید: اگر شناسه تمدید (renewalIdentifier) وجود دارد.
            renewalResult = await renewSubscription(doc, renewalIdentifier, requestedPlan, purchaseDate);
            userLink = renewalResult.originalLink;
            finalPlanName = `${requestedPlan} (تمدید پلن ${renewalResult.originalSheetTitle})`;
            isRenewalSuccess = true;
            
        } else if (finalSheetTitle) {
            // منطق خرید جدید: اگر شناسه تمدید ندارد.
            // **FIX:** در اینجا باید لینک اشتراک برای کاربر ایجاد شود. 
            // فرض می‌کنیم تابع/سرویس تولید لینک در جای دیگری اجرا می‌شود و لینک در این متغیر قرار می‌گیرد.
            userLink = `https://link-generator.ir/aytechnic-${trackingId}`; 
            finalPlanName = `${requestedPlan} - ${users} کاربر`;
        }

        // 4. ثبت ردیف در شیت Renew (هم برای خرید جدید و هم تمدید)
        const renewSheet = doc.sheetsByTitle[RENEW_SHEET_TITLE];
        if (renewSheet) {
            await renewSheet.loadHeaderRow(1);
            await renewSheet.addRow({
                'trackingId': trackingId,
                'purchaseDate': purchaseDate,
                'name': name || 'کاربر وب',
                'email': email || '',
                'phone': phone || '',
                'chat_id': telegramId || chat_id,
                'telegramUsername': telegramUsername || '',
                'renewalIdentifier': renewalIdentifier || 'خرید جدید',
                'requestedPlan': requestedPlan,
                'users': users,
                'amount': verifyResult.data.amount,
                'coupenCode': coupenCode || 'ندارد',
                'discountAmount': appliedCoupon ? appliedCoupon.discount : 0,
                'status': isRenewalSuccess ? 'تمدید موفق' : 'خرید جدید موفق',
                'link': userLink,
                'description': description || 'پرداخت از وبسایت',
                'OriginalSheet': finalSheetTitle,
            });
        }
        
        // 5. به‌روزرسانی شیت کوپن
        await updateCouponUsage(appliedCoupon);

        // 6. اطلاع‌رسانی به مدیر
        const adminMessage = `✅ **${isRenewalSuccess ? 'تمدید موفق' : 'خرید موفق'}**\n\n` +
                             `👤 نام: ${name || 'وبسایت'}\n` +
                             `🔗 پلن: ${finalPlanName}\n` +
                             `💵 مبلغ نهایی: ${verifyResult.data.amount.toLocaleString()} تومان\n` +
                             `🆔 شناسه پیگیری: ${trackingId}\n` +
                             `🎟 کوپن: ${coupenCode || 'ندارد'}\n` +
                             `🗓 انقضای جدید: ${renewalResult ? renewalResult.newExpiryDate : 'نامشخص (باید در شیت اصلی ثبت شود)'}\n` +
                             `✉️ لینک: ${userLink}`;

        bot.sendMessage(ADMIN_CHAT_ID, adminMessage, { parse_mode: 'Markdown' });
        
        // 7. ارسال پاسخ موفقیت‌آمیز به کاربر
        return res.status(200).send(renderHTML('✅ پرداخت موفق', finalPlanName, userLink, trackingId, isRenewalSuccess));

    } catch (error) {
        console.error('Critical Error in Verify:', error);
        
        // ارسال خطا به مدیر
        bot.sendMessage(ADMIN_CHAT_ID, `❌ **خطای بحرانی در فرآیند Verify** (TID: ${trackingId || 'N/A'})\n\nپیام خطا: ${error.message}\n\nلطفا به‌صورت دستی بررسی کنید.`, { parse_mode: 'Markdown' });
        
        return res.status(500).send(renderHTML('❌ خطای سرور', 'خطای داخلی سرور در هنگام تایید نهایی پرداخت. لطفا با شناسه پیگیری خود (در صورت وجود) به پشتیبانی مراجعه کنید.', null, trackingId, false));
    }
};

// --- تابع رندر HTML نهایی (بدون تغییر) ---
function renderHTML(title, plan, userLink, trackingId, isRenewal = false) {
    const statusClass = title.includes('موفق') ? 'success' : 'error';
    const message = isRenewal ? 'تمدید اشتراک شما با موفقیت انجام شد!' : 'خرید اشتراک شما با موفقیت انجام شد!';
    const userMessage = userLink ? `لینک اشتراک شما: <span>${userLink}</span>` : 'لینک اشتراک شما: **لینک به دلیل خطا نامشخص است.**';

    return `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        @font-face {
            font-family: 'Vazirmatn';
            src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Bold.woff2') format('woff2');
            font-weight: 700;
            font-display: swap;
        }
        @font-face {
            font-family: 'Vazirmatn';
            src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Medium.woff2') format('woff2');
            font-weight: 500;
            font-display: swap;
        }
        body {
            font-family: 'Vazirmatn', sans-serif;
            background-color: #f4f7f9;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            text-align: center;
        }
        .container {
            background-color: #fff;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
            max-width: 500px;
            width: 90%;
            border-top: 5px solid var(--main-color);
        }
        .success { --main-color: #4CAF50; }
        .error { --main-color: #F44336; }
        .warning { --main-color: #FF9800; }

        .icon {
            font-size: 48px;
            color: var(--main-color);
            margin-bottom: 20px;
        }
        h1 {
            color: #333;
            font-weight: 700;
            margin-top: 0;
        }
        p {
            color: #555;
            line-height: 1.6;
            margin-bottom: 20px;
        }
        .details {
            background-color: #f0f0f0;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 25px;
            text-align: right;
            border: 1px solid #ddd;
        }
        .details p {
            margin: 5px 0;
            color: #333;
            font-weight: 500;
        }
        .subscription-box {
            background-color: #e8f5e9; 
            border: 2px dashed #a5d6a7; 
            padding: 15px;
            border-radius: 8px;
            word-break: break-all;
            margin-bottom: 20px;
            text-align: left;
            position: relative;
        }
        .subscription-link {
            font-family: monospace;
            font-size: 14px;
            color: #1b5e20;
            display: block;
        }
        .actions {
            display: flex;
            gap: 10px;
            margin-top: 10px;
            justify-content: flex-end;
        }
        .actions button {
            background: #4CAF50;
            color: white;
            border: none;
            padding: 8px 12px;
            border-radius: 6px;
            cursor: pointer;
            transition: background-color 0.3s;
            font-size: 14px;
            display: flex;
            align-items: center;
            font-family: 'Vazirmatn', sans-serif;
        }
        .actions button:hover {
            background-color: #43a047;
        }
        .actions button svg {
            width: 18px;
            height: 18px;
            margin-left: 5px; 
        }

        .renewal-message {
            color: #1b5e20;
            font-weight: 700;
            margin-top: 0;
        }
    </style>
</head>
<body class="${statusClass}">
    <div class="container">
        <div class="icon">
            ${title.includes('موفق') ? (isRenewal ? '🔁' : '🎉') : '❌'}
        </div>
        <h1>${title}</h1>
        <p>${message}</p>
        
        ${isRenewal ? `<h3 class="renewal-message">تبریک! تمدید شما با موفقیت ثبت شد.</h3>` : ''}

        <div class="details">
            <p><strong>پلن:</strong> ${plan}</p>
            ${trackingId ? `<p><strong>شناسه پیگیری (برای پیگیری‌های بعدی):</strong> ${trackingId}</p>` : ''}
            ${userLink ? `
                <p><strong>لینک اشتراک:</strong></p>
                <div class="subscription-box">
                    <code class="subscription-link" id="subLink">${userLink}</code>
                    <div class="actions">
                        <button id="copyBtn" title="کپی لینک"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"></path></svg> کپی لینک</button>
                        <button id="openBtn" title="باز کردن لینک"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h11c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"></path></svg> باز کردن</button>
                    </div>
                </div>
            ` : ''}
        </div>
        
        <p style="font-size: 14px; color: #777;">در صورت بروز هرگونه مشکل، لطفاً با شناسه پیگیری به پشتیبانی Ay Technic مراجعه کنید.</p>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', () => {
            const copyBtn = document.getElementById('copyBtn');
            const openBtn = document.getElementById('openBtn');
            const subLink = document.getElementById('subLink');
            
            if (copyBtn && subLink) {
                copyBtn.addEventListener('click', () => {
                    navigator.clipboard.writeText(subLink.textContent).then(() => {
                        const originalText = copyBtn.textContent;
                        copyBtn.textContent = 'کپی شد!';
                        copyBtn.style.backgroundColor = '#1b5e20';
                        setTimeout(() => {
                            copyBtn.textContent = originalText;
                            copyBtn.style.backgroundColor = '#4CAF50';
                        }, 2000);
                    }).catch(err => {
                        console.error('Copy failed:', err);
                    });
                });
            }

            if (openBtn && subLink) {
                openBtn.addEventListener('click', () => {
                    window.open(subLink.textContent, '_blank');
                });
            }
        });
    </script>
</body>
</html>
    `;
}
