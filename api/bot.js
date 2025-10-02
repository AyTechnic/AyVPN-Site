const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
// NEW: اضافه شدن کتابخانه‌های Google Sheet برای خواندن کوپن
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// --- متغیرهای شما ---
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const APP_URL = process.env.APP_URL;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID; // NEW: باید در محیط تعریف شده باشد
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL; // NEW
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY; // NEW

// **تغییر ۱: حذف { polling: true }** // ربات به صورت Webhook تنظیم می‌شود و فقط برای ارسال پیام‌ها و پردازش آپدیت‌های دریافتی استفاده می‌شود.
const bot = new TelegramBot(TOKEN); 

// NEW: نام شیت کوپن
const COUPEN_SHEET_TITLE = 'Coupen';

// NEW: مدیریت وضعیت کاربر برای ورودی‌های چند مرحله‌ای (برای تمدید و پیگیری) و ذخیره تعداد کاربر
const userStates = {};

// --- توابع کمکی Google Sheet (تکرار از verify.js) ---
async function getDoc() {
    // احراز هویت سرویس گوگل
    const serviceAccountAuth = new JWT({
        email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    return doc;
}

// NEW: تابع اصلی دریافت کوپن از شیت
async function getCoupenDetails(coupenCode) {
    if (!coupenCode) return null;
    try {
        const doc = await getDoc();
        const sheet = doc.sheetsByTitle[COUPEN_SHEET_TITLE];
        if (!sheet) {
            console.error(`Coupen sheet not found with title: ${COUPEN_SHEET_TITLE}`);
            return null;
        }
        
        // اطمینان از بارگیری هدرهای صحیح (ستون اول هدر است)
        await sheet.loadHeaderRow(1); 
        
        const rows = await sheet.getRows();
        const coupenRow = rows.find(row => row.get('coupen').toLowerCase() === coupenCode.toLowerCase());

        if (coupenRow) {
            const expiryDate = coupenRow.get('expiryDate');
            const manyTimes = coupenRow.get('manyTimes');
            
            // بررسی تاریخ انقضا
            if (expiryDate && new Date(expiryDate) < new Date()) {
                return { error: 'تاریخ انقضای این کد تخفیف گذشته است.' };
            }
            
            // بررسی تعداد مجاز استفاده (در صورتی که محدود باشد)
            if (manyTimes && manyTimes !== 'unlimited' && parseInt(manyTimes) <= 0) {
                 return { error: 'ظرفیت استفاده از این کد تخفیف به پایان رسیده است.' };
            }
            
            // اطلاعات کوپن معتبر
            return {
                coupen: coupenRow.get('coupen'),
                percent: parseInt(coupenRow.get('percent')) || 0,
                price: parseInt(coupenRow.get('price')) || 0,
                manyTimes: manyTimes,
                description: coupenRow.get('description'),
                row: coupenRow // ارسال ردیف برای به‌روزرسانی بعدی (اختیاری اما مفید)
            };
        }
        
        return null; // کوپن یافت نشد
    } catch (error) {
        console.error('Error fetching coupen details:', error.message);
        return null; // خطای سیستمی
    }
}

// تابع محاسبه قیمت چند کاربره (قبلی)
const calculateMultiUserPrice = (basePrice, users) => {
    // Price = Base Price + (Users - 1) * 50% of Base Price
    const multiplier = 1 + (users - 1) * 0.5;
    return Math.round(basePrice * multiplier / 1000) * 1000; // گرد کردن به نزدیکترین ۱۰۰۰ تومان
};

// NEW: تابع اعمال تخفیف
const applyCoupenDiscount = (originalAmount, coupenDetails) => {
    let finalAmount = originalAmount;
    let discountAmount = 0;
    
    if (coupenDetails) {
        if (coupenDetails.percent > 0) {
            // تخفیف درصدی
            discountAmount = Math.round(originalAmount * coupenDetails.percent / 100);
        } else if (coupenDetails.price > 0) {
            // تخفیف مبلغی ثابت (اگرچه شما در شیت از percent استفاده کردید، اما این قابلیت اضافه شد)
            discountAmount = coupenDetails.price;
        }
        
        finalAmount = originalAmount - discountAmount;
        
        // اطمینان از اینکه قیمت نهایی کمتر از صفر نشود (حداقل یک تومان)
        if (finalAmount < 1000) {
            finalAmount = 1000; 
            discountAmount = originalAmount - 1000;
        }
    }
    
    return {
        finalAmount: finalAmount,
        discountAmount: discountAmount
    };
};

const formatAmount = (amount) => amount.toLocaleString('fa-IR');

// --- داده های ربات (ساختار بر اساس قیمت پایه ۱ کاربره) ---
// ... (ادامه plansData و apps) ...
const plansData = [
    { duration: '۱ ماهه', baseAmount: 120000, durationDays: 30, type: 'unlimited', icon: '💎', requestedPlan: '1M' },
    { duration: '۲ ماهه', baseAmount: 220000, durationDays: 60, type: 'unlimited', icon: '🚀', requestedPlan: '2M' },
    { duration: '۳ ماهه', baseAmount: 340000, durationDays: 90, type: 'unlimited', icon: '🌟', requestedPlan: '3M' },
    { duration: '۶ ماهه', baseAmount: 600000, durationDays: 180, type: 'unlimited', icon: '🔥', requestedPlan: '6M' },
    { duration: '۱ ساله', baseAmount: 1000000, durationDays: 365, type: 'unlimited', icon: '👑', requestedPlan: '1Y' },
    { duration: '۲ ساله', baseAmount: 2000000, durationDays: 730, type: 'unlimited', icon: '♾️', requestedPlan: '2Y' },
];

const apps = {
    android: [
        { text: 'V2rayNG', url: 'https://play.google.com/store/apps/details?id=com.v2ray.ang' },
        { text: 'NapsternetV', url: 'https://play.google.com/store/apps/details?id=com.napsternetv' }
    ],
    ios: [
        { text: 'Shadowrocket', url: 'https://apps.apple.com/us/app/shadowrocket/id932747118' },
        { text: 'V2Box', url: 'https://apps.apple.com/us/app/v2box-v2ray-client/id6446814677' }
    ],
    windows: [
        { text: 'V2rayN', url: 'https://github.com/v2rayA/v2rayA/releases' },
    ],
    mac: [
        { text: 'V2rayX', url: 'https://github.com/Cenmrev/V2RayX/releases' },
    ]
};

const appsMenu = {
    inline_keyboard: [
        [{ text: '🤖 اندروید', callback_data: 'apps_android' }],
        [{ text: '🍎 iOS', callback_data: 'apps_ios' }],
        [{ text: '💻 ویندوز', callback_data: 'apps_windows' }],
        [{ text: '🖥️ مک', callback_data: 'apps_mac' }],
        [{ text: '⬅️ بازگشت به منو اصلی', callback_data: 'menu_main' }]
    ]
};


// --- مدیریت دستورات ---

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    delete userStates[chatId]; // ریست کردن وضعیت کاربر
    const welcomeMessage = `سلام شــــامـــــــــای عزیز! به ربات خرید و تمدید اشتراک **Ay Technic** خوش آمدید.\n\nلطفاً برای ادامه یکی از گزینه‌های زیر را انتخاب کنید:`;
    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🛒 خرید اشتراک جدید', callback_data: 'menu_purchase' }],
                [{ text: '🔄 تمدید اشتراک', callback_data: 'state_renew' }],
                [{ text: '🔍 پیگیری سفارش', callback_data: 'state_track' }],
                [{ text: '📱 برنامه‌های پیشنهادی', callback_data: 'menu_apps' }]
            ]
        },
        parse_mode: 'Markdown'
    };
    bot.sendMessage(chatId, welcomeMessage, keyboard);
});

// --- مدیریت پیام‌های متنی (برای ورودی‌های چند مرحله‌ای) ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text.startsWith('/') || !userStates[chatId] || !msg.text) return;

    const state = userStates[chatId].step;

    if (state === 'waiting_for_renew_id') {
        userStates[chatId].renewalIdentifier = text;
        userStates[chatId].step = 'waiting_for_renew_coupen';
        return bot.sendMessage(chatId, 'کد تخفیف را وارد کنید (اگر کد تخفیف ندارید، **0** را ارسال کنید):');
    }

    if (state === 'waiting_for_track_id') {
        const trackingId = text;
        delete userStates[chatId];
        
        try {
            const response = await fetch(`${APP_URL}/api/track?trackingId=${trackingId}`);
            if (response.status === 200) {
                const purchases = await response.json();
                let message = `✅ **سفارشات یافت شده برای شناسه ${trackingId}:**\n\n`;
                purchases.forEach(p => {
                    const planDisplay = p.plan.endsWith('D') ? `${parseInt(p.plan)} روزه` : (p.plan === 'Renew' ? 'تمدید' : p.plan);
                    message += `* پلن: ${planDisplay}\n`;
                    message += `* تاریخ خرید: ${p.date}\n`;
                    message += `* لینک اشتراک: \`${p.link}\`\n`;
                    message += `* وضعیت: موفق\n\n`;
                });
                return bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            } else if (response.status === 404) {
                return bot.sendMessage(chatId, '❌ سفارشی با این شناسه پیگیری یافت نشد.');
            } else {
                throw new Error('Server Error');
            }
        } catch (error) {
            console.error('Tracking Error:', error.message);
            return bot.sendMessage(chatId, '❌ خطای سرور در پیگیری سفارش.');
        }
    }

    // NEW: گام ۳: دریافت کد تخفیف برای خرید جدید
    if (state === 'waiting_for_purchase_coupen') {
        const coupenCode = text === '0' ? '' : text;
        userStates[chatId].coupenCode = coupenCode;
        userStates[chatId].step = 'waiting_for_user_info';

        // --- محاسبه قیمت ---
        const plan = plansData.find(p => p.requestedPlan === userStates[chatId].requestedPlan);
        const users = parseInt(userStates[chatId].users);
        const originalAmount = calculateMultiUserPrice(plan.baseAmount, users);

        let finalAmount = originalAmount;
        let discountMessage = '';
        let discountAmount = 0;

        if (coupenCode) {
            const coupenDetails = await getCoupenDetails(coupenCode);
            if (coupenDetails && !coupenDetails.error) {
                const discountResult = applyCoupenDiscount(originalAmount, coupenDetails);
                finalAmount = discountResult.finalAmount;
                discountAmount = discountResult.discountAmount;
                discountMessage = `✅ کد تخفیف **${coupenCode}** اعمال شد. مبلغ تخفیف: **${formatAmount(discountAmount)} تومان**.\n`;
                
                // NEW: ذخیره جزئیات کوپن برای استفاده در مرحله پرداخت
                userStates[chatId].coupenDetails = coupenDetails; 

            } else {
                // اگر کوپن نامعتبر باشد
                discountMessage = `⚠️ کد تخفیف نامعتبر یا منقضی شده است. لطفاٌ یک کد معتبر وارد کنید یا **0** را ارسال کنید.`;
                // اگر کد تخفیف نامعتبر بود، دوباره از کاربر بخواهید
                userStates[chatId].step = 'waiting_for_purchase_coupen'; 
                return bot.sendMessage(chatId, discountMessage);
            }
        }

        userStates[chatId].finalAmount = finalAmount;
        
        const message = `${discountMessage}
        💰 مبلغ نهایی: **${formatAmount(finalAmount)} تومان**
        
        لطفاً نام و نام خانوادگی، شماره تماس و ایمیل خود را **در یک خط و به ترتیب** زیر وارد کنید:
        
        **مثال:** شامای ایرانی، 09121234567، shammay@aytechnic.com
        
        *ایمیل و شماره تماس برای پیگیری سفارشات ضروری هستند.*
        `;
        
        return bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    }
    
    // NEW: گام ۴: دریافت اطلاعات کاربر برای خرید جدید
    if (state === 'waiting_for_user_info') {
        const parts = text.split(/[,،]/).map(p => p.trim()).filter(p => p.length > 0);
        if (parts.length < 3) {
            return bot.sendMessage(chatId, '❌ فرمت وارد شده صحیح نیست. لطفاً نام و نام خانوادگی، شماره تماس و ایمیل را با کاما جدا کنید. (مثال: شامای ایرانی، 09121234567، shammay@aytechnic.com)');
        }
        
        // اعتبار سنجی ساده
        const [name, phone, email] = parts;
        const phoneRegex = /^09\d{9}$/;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        
        if (!phoneRegex.test(phone)) {
            return bot.sendMessage(chatId, '❌ شماره تماس وارد شده نامعتبر است. (مثال: 09121234567)');
        }
        if (!emailRegex.test(email)) {
            return bot.sendMessage(chatId, '❌ ایمیل وارد شده نامعتبر است. (مثال: shammay@aytechnic.com)');
        }
        
        // ذخیره اطلاعات و آماده سازی برای پرداخت
        userStates[chatId].name = name;
        userStates[chatId].phone = phone;
        userStates[chatId].email = email;
        userStates[chatId].step = 'ready_to_pay';
        
        const finalAmount = userStates[chatId].finalAmount;
        const plan = plansData.find(p => p.requestedPlan === userStates[chatId].requestedPlan);

        const summary = `
        **خلاصه سفارش شما:**
        
        * 👤 نام: ${name}
        * 📞 تماس: ${phone}
        * 📧 ایمیل: ${email}
        * 🗓️ پلن: ${plan.duration}
        * 👥 تعداد کاربر: ${userStates[chatId].users}
        * 💵 مبلغ قابل پرداخت: **${formatAmount(finalAmount)} تومان**
        
        آیا برای شروع فرآیند پرداخت آنلاین آماده هستید؟
        `;
        
        const keyboard = {
            inline_keyboard: [
                [{ text: '✅ شروع پرداخت', callback_data: 'pay_start_purchase' }],
                [{ text: '⬅️ بازگشت به منو اصلی', callback_data: 'menu_main' }]
            ]
        };
        
        return bot.sendMessage(chatId, summary, { reply_markup: keyboard, parse_mode: 'Markdown' });

    }
    
    // --- مدیریت ورودی کوپن برای تمدید ---
    if (state === 'waiting_for_renew_coupen') {
        const coupenCode = text === '0' ? '' : text;
        userStates[chatId].coupenCode = coupenCode;
        
        // ... (منطق مشابه برای تمدید، با فرض اینکه تمدید به یک API متفاوت متصل می‌شود)
        
        // **********************************************
        // NOTE: این بخش از کد تمدید ناقص است و نیاز به تکمیل دارد
        // اما برای سازگاری با ورسل، ساختار آن را نگه می‌داریم.
        // **********************************************
        
        const plan = plansData[0]; // فرض می‌کنیم پلن تمدید ۱ ماهه است تا خطا ندهد
        userStates[chatId].requestedPlan = plan.requestedPlan;
        userStates[chatId].finalAmount = plan.baseAmount; // مبلغ تمدید
        userStates[chatId].renewalIdentifier = userStates[chatId].renewalIdentifier; // شناسه تمدید
        
        userStates[chatId].step = 'ready_to_pay';
        
        const summary = `
        **خلاصه تمدید شما:**
        * 🔑 شناسه تمدید: ${userStates[chatId].renewalIdentifier}
        * 💵 مبلغ قابل پرداخت: **${formatAmount(userStates[chatId].finalAmount)} تومان**
        
        آیا برای شروع فرآیند پرداخت آنلاین آماده هستید؟
        `;
        
        const keyboard = {
            inline_keyboard: [
                [{ text: '✅ شروع پرداخت', callback_data: 'pay_start_renew' }],
                [{ text: '⬅️ بازگشت به منو اصلی', callback_data: 'menu_main' }]
            ]
        };
        
        return bot.sendMessage(chatId, summary, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }

});

// --- مدیریت دکمه‌های اینلاین ---
bot.on('callback_query', async (query) => {
    const data = query.data;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    // ریست به منو اصلی
    if (data === 'menu_main') {
        // حذف وضعیت فعلی کاربر
        delete userStates[chatId]; 
        
        const welcomeMessage = `سلام شــــامـــــــــای عزیز! به منو اصلی ربات خرید و تمدید اشتراک **Ay Technic** خوش آمدید.\n\nلطفاً برای ادامه یکی از گزینه‌های زیر را انتخاب کنید:`;
        const keyboard = {
            inline_keyboard: [
                [{ text: '🛒 خرید اشتراک جدید', callback_data: 'menu_purchase' }],
                [{ text: '🔄 تمدید اشتراک', callback_data: 'state_renew' }],
                [{ text: '🔍 پیگیری سفارش', callback_data: 'state_track' }],
                [{ text: '📱 برنامه‌های پیشنهادی', callback_data: 'menu_apps' }]
            ]
        };
        return bot.editMessageText(welcomeMessage, { chat_id: chatId, message_id: messageId, reply_markup: keyboard, parse_mode: 'Markdown' });
    }

    // --- ۱. مدیریت خرید جدید (انتخاب پلن) ---
    if (data === 'menu_purchase') {
        // ریست کردن وضعیت برای خرید جدید
        userStates[chatId] = { step: 'awaiting_plan_select' }; 
        
        const keyboard = plansData.map(p => ([{ text: `${p.icon} ${p.duration} - ${formatAmount(p.baseAmount)} تومان`, callback_data: `plan_select_${p.requestedPlan}` }]));
        keyboard.push([{ text: '⬅️ بازگشت به منو اصلی', callback_data: 'menu_main' }]);
        
        return bot.editMessageText('🛍️ لطفاً مدت زمان اشتراک مورد نظر خود را انتخاب کنید (قیمت برای ۱ کاربر است):', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'Markdown'
        });
    }

    // --- ۲. مدیریت انتخاب پلن و رفتن به انتخاب تعداد کاربر ---
    if (data.startsWith('plan_select_')) {
        const requestedPlan = data.split('_')[2];
        userStates[chatId] = { step: 'awaiting_user_select', requestedPlan: requestedPlan };
        
        // ایجاد کیبورد انتخاب تعداد کاربر
        const userCountKeyboard = {
            inline_keyboard: [
                [{ text: '👥 ۱ کاربر', callback_data: 'user_select_1' }],
                [{ text: '👥 ۲ کاربر', callback_data: 'user_select_2' }],
                [{ text: '👥 ۳ کاربر', callback_data: 'user_select_3' }],
                [{ text: '👥 ۴ کاربر', callback_data: 'user_select_4' }],
                [{ text: '⬅️ بازگشت به پلن‌ها', callback_data: 'menu_purchase' }]
            ]
        };
        
        const plan = plansData.find(p => p.requestedPlan === requestedPlan);
        const planText = `${plan.icon} ${plan.duration}`;

        return bot.editMessageText(`✅ پلن ${planText} انتخاب شد. لطفاً تعداد کاربر مورد نیاز خود را انتخاب کنید:`, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: userCountKeyboard,
            parse_mode: 'Markdown'
        });
    }

    // --- ۳. مدیریت انتخاب تعداد کاربر و رفتن به دریافت کوپن ---
    if (data.startsWith('user_select_')) {
        const users = data.split('_')[2];
        const state = userStates[chatId];
        
        if (!state || state.step !== 'awaiting_user_select') return;
        
        state.users = users;
        state.step = 'waiting_for_purchase_coupen';
        
        const plan = plansData.find(p => p.requestedPlan === state.requestedPlan);
        const originalAmount = calculateMultiUserPrice(plan.baseAmount, parseInt(users));
        
        const message = `
        ✅ تعداد **${users} کاربره** انتخاب شد.
        💰 مبلغ اولیه: **${formatAmount(originalAmount)} تومان**
        
        کد تخفیف را وارد کنید (اگر کد تخفیف ندارید، **0** را ارسال کنید):
        `;
        
        // **مهم: چون نیاز به ورودی متنی داریم، این پیام را به صورت عادی ارسال می‌کنیم**
        // و از کاربر می‌خواهیم که کد تخفیف را در پیام متنی بعدی وارد کند.
        await bot.deleteMessage(chatId, messageId);
        return bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    }


    // --- ۴. مدیریت پیگیری سفارش ---
    if (data === 'state_track') {
        // حذف پیام فعلی و درخواست ورودی
        await bot.deleteMessage(chatId, messageId);
        userStates[chatId] = { step: 'waiting_for_track_id' };
        return bot.sendMessage(chatId, '🔍 لطفاً **کد رهگیری** یا **شماره تماس/ایمیل** ثبت شده در سفارش خود را برای پیگیری ارسال کنید:');
    }


    // --- ۵. مدیریت تمدید اشتراک ---
    if (data === 'state_renew') {
        // حذف پیام فعلی و درخواست ورودی
        await bot.deleteMessage(chatId, messageId);
        userStates[chatId] = { step: 'waiting_for_renew_id' };
        return bot.sendMessage(chatId, '🔄 لطفاً **لینک اشتراک** یا **شناسه تمدید** (در صورت داشتن) خود را برای شروع فرآیند تمدید ارسال کنید:');
    }


    // --- ۶. مدیریت شروع پرداخت (برای خرید جدید) ---
    if (data === 'pay_start_purchase' || data === 'pay_start_renew') {
        const state = userStates[chatId];
        if (!state || state.step !== 'ready_to_pay') return;
        
        const isRenew = data === 'pay_start_renew';
        const plan = plansData.find(p => p.requestedPlan === state.requestedPlan);
        
        const description = isRenew 
            ? `تمدید اشتراک Ay Technic - شناسه: ${state.renewalIdentifier}`
            : `خرید اشتراک Ay Technic - پلن: ${plan.duration} - کاربران: ${state.users}`;

        // داده‌های ارسال به API پرداخت
        const payload = {
            amount: state.finalAmount,
            description: description,
            chat_id: chatId,
            name: state.name || 'N/A',
            email: state.email || 'N/A',
            phone: state.phone || 'N/A',
            renewalIdentifier: isRenew ? state.renewalIdentifier : '',
            requestedPlan: state.requestedPlan,
            coupenCode: state.coupenCode || '',
            telegramUsername: query.from.username || 'N/A',
            telegramId: query.from.id.toString(),
            users: state.users || '1',
            // NEW: جزئیات کوپن برای کاهش تعداد استفاده در verify.js
            coupenDetails: state.coupenDetails || {} 
        };

        try {
            // فراخوانی API شروع پرداخت در Vercel
            const response = await fetch(`${APP_URL}/api/start-payment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const responseData = await response.json();

            if (response.ok && responseData.authority) {
                const paymentLink = `https://www.zarinpal.com/pg/StartPay/${responseData.authority}`;
                await bot.editMessageText('🔗 لینک پرداخت شما آماده شد. لطفاً پرداخت را از طریق دکمه زیر تکمیل کنید:', {
                    chat_id: chatId, message_id: messageId,
                    reply_markup: { inline_keyboard: [[{ text: '💳 پرداخت آنلاین', url: paymentLink }]] }
                });
            } else {
                throw new Error(responseData.details || 'سرور درگاه پرداخت پاسخ نداد.');
            }
        } catch (error) {
            console.error('Payment Error:', error.message);
            bot.sendMessage(chatId, '❌ خطای سرور در شروع پرداخت. لطفاً بعداً تلاش کنید.');
        }

        // پس از شروع پرداخت، وضعیت تمدید/خرید را حذف می‌کنیم
        delete userStates[chatId];
    }
    
    
    // --- ۷. مدیریت منوی برنامه‌ها ---
    if (data === 'menu_apps') {
        return bot.editMessageText('📱 لطفاً سیستم عامل خود را برای مشاهده برنامه‌های پیشنهادی انتخاب کنید:', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: appsMenu.inline_keyboard
        });
    }

    if (data.startsWith('apps_')) {
        const type = data.split('_')[1];
        const appList = apps[type];
        
        const typeText = (type === 'android') ? 'اندروید' : (type === 'ios') ? 'iOS' : (type === 'windows') ? 'ویندوز' : 'مک';
        
        const keyboard = appList.map(a => ([{ text: a.text, url: a.url }]));
        keyboard.push([{ text: '⬅️ بازگشت به برنامه‌ها', callback_data: 'menu_apps' }]);
        keyboard.push([{ text: '⬅️ بازگشت به منو اصلی', callback_data: 'menu_main' }]);

        return bot.editMessageText(`✅ برنامه‌های پیشنهادی برای **${typeText}**:`, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'Markdown'
        });
    }
    
    // پاسخ به Callback Query برای جلوگیری از علامت بارگذاری
    bot.answerCallbackQuery(query.id); 

});


// **تغییر ۲: تبدیل کل کد به تابع ورسل (مهم‌ترین بخش)**
module.exports = async (req, res) => {
    
    // فقط درخواست‌های POST را پردازش کنید (Webhook)
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    // تلگرام یک شیء آپدیت در بدنه درخواست POST ارسال می‌کند.
    const update = req.body;
    
    try {
        // **تغییر ۳: ارسال آپدیت به Listenerهای ربات:**
        // این کار باعث می‌شود تمام bot.onText و bot.on('message'/'callback_query') اجرا شوند.
        bot.processUpdate(update);
        
        // **تغییر ۴: پاسخ سریع به تلگرام:**
        // این پاسخ 200 OK تضمین می‌کند که تلگرام وب‌هوک شما را موفقیت‌آمیز تلقی کرده و آن را لغو نکند.
        res.status(200).send('OK');

    } catch (error) {
        console.error('Vercel Webhook Processing Error:', error.message);
        // حتی در صورت خطای داخلی در کد شما، باز هم به تلگرام 200 OK برگردانید
        // تا تلگرام خیال کند پیام دریافت شده و از لغو Webhook جلوگیری شود.
        res.status(200).send('Error Processed');
    }
};
