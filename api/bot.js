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
const bot = new TelegramBot(TOKEN, { polling: true });

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
            } else {
                // اگر کوپن نامعتبر باشد
                discountMessage = `⚠️ کد تخفیف نامعتبر یا منقضی شده است. (${coupenDetails?.error || 'کوپن یافت نشد'})\n`;
            }
        }

        userStates[chatId].finalAmount = finalAmount;
        userStates[chatId].discountAmount = discountAmount;
        
        // --- نمایش اطلاعات نهایی و درخواست مشخصات ---
        
        let infoMessage = `**اطلاعات سفارش:**\n`;
        infoMessage += `* پلن: ${plan.duration}\n`;
        infoMessage += `* تعداد کاربران: ${users} نفر\n`;
        infoMessage += `* قیمت پایه: **${formatAmount(originalAmount)} تومان**\n`;
        infoMessage += discountMessage;
        infoMessage += `* مبلغ نهایی قابل پرداخت: **${formatAmount(finalAmount)} تومان**\n\n`;
        infoMessage += 'لطفاً نام و نام خانوادگی، ایمیل و شماره تلفن خود را به ترتیب زیر در یک پیام ارسال کنید:\n\n`نام و نام خانوادگی، ایمیل، شماره تلفن`\n\n**مثال:** `شـــامـــــای، shammay@aytechnic.ir، 0912xxxxxxx`';
        
        return bot.sendMessage(chatId, infoMessage, { parse_mode: 'Markdown' });
    }
    
    // گام نهایی برای خرید/تمدید: دریافت اطلاعات کاربر
    if (state === 'waiting_for_user_info' || state === 'waiting_for_renew_user_info') {
        // ... (منطق دریافت مشخصات کاربر و شروع پرداخت)
        
        const parts = text.split(/[،,]/).map(p => p.trim()).filter(p => p.length > 0);
        if (parts.length < 3) {
            return bot.sendMessage(chatId, '❌ فرمت اطلاعات وارد شده صحیح نیست. لطفاً با کاما (,) یا ویرگول فارسی (،) از هم جدا کنید و مجدداً ارسال کنید. \n\nمثال: `نام و نام خانوادگی، ایمیل، شماره تلفن`');
        }

        const [name, email, phone] = parts;
        
        // ذخیره اطلاعات کاربر در وضعیت
        userStates[chatId].name = name;
        userStates[chatId].email = email;
        userStates[chatId].phone = phone;

        // تعیین نوع درخواست و مبلغ
        const isRenew = userStates[chatId].step === 'waiting_for_renew_user_info';
        const amount = isRenew ? userStates[chatId].finalAmount : userStates[chatId].finalAmount;
        const requestedPlan = isRenew ? userStates[chatId].requestedPlan : userStates[chatId].requestedPlan;
        const users = isRenew ? userStates[chatId].users : userStates[chatId].users;
        const coupenCode = isRenew ? userStates[chatId].coupenCode : userStates[chatId].coupenCode; // NEW: استفاده از کوپن کد ذخیره شده
        const description = isRenew ? `تمدید پلن ${requestedPlan} برای ${users} کاربر` : `خرید پلن ${requestedPlan} برای ${users} کاربر`;

        // فراخوانی API شروع پرداخت
        try {
            const response = await fetch(`${APP_URL}/api/start-payment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount: amount,
                    description: description,
                    chat_id: chatId,
                    name: name,
                    email: email,
                    phone: phone,
                    requestedPlan: requestedPlan,
                    renewalIdentifier: isRenew ? userStates[chatId].renewalIdentifier : '',
                    coupenCode: coupenCode, // NEW: ارسال کوپن کد به start-payment.js
                    users: users, // NEW: ارسال تعداد کاربران
                    telegramUsername: msg.from.username || '',
                    telegramId: msg.from.id,
                }),
            });

            const result = await response.json();
            
            if (response.ok && result.authority) {
                const paymentUrl = `https://www.zarinpal.com/pg/StartPay/${result.authority}`;
                
                const keyboard = [
                    [{ text: '🔗 ورود به صفحه پرداخت', url: paymentUrl }],
                    [{ text: '⬅️ بازگشت به منو اصلی', callback_data: 'menu_main' }]
                ];
                
                return bot.sendMessage(chatId, '✅ لینک پرداخت ایجاد شد. لطفاً برای تکمیل خرید خود اقدام کنید:', {
                    reply_markup: { inline_keyboard: keyboard }
                });
            } else {
                return bot.sendMessage(chatId, `❌ خطا در ایجاد لینک پرداخت: ${result.error || 'خطای ناشناخته'}`);
            }
        } catch (error) {
            console.error('Start Payment Error:', error.message);
            bot.sendMessage(chatId, '❌ خطای سرور در شروع پرداخت. لطفاً بعداً تلاش کنید.');
        }

        // پس از شروع پرداخت، وضعیت تمدید/خرید را حذف می‌کنیم
        delete userStates[chatId];
    }
});


// --- مدیریت Callback Query ---
bot.on('callback_query', async (query) => {
    const data = query.data;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    // --- ۱. مدیریت منو اصلی و بازگشت ---
    if (data === 'menu_main') {
        // ریست کردن وضعیت کاربر
        delete userStates[chatId]; 
        const welcomeMessage = `سلام شــــامـــــــــای عزیز! به ربات خرید و تمدید اشتراک **Ay Technic** خوش آمدید.\n\nلطفاً برای ادامه یکی از گزینه‌های زیر را انتخاب کنید:`;
        const keyboard = [
            [{ text: '🛒 خرید اشتراک جدید', callback_data: 'menu_purchase' }],
            [{ text: '🔄 تمدید اشتراک', callback_data: 'state_renew' }],
            [{ text: '🔍 پیگیری سفارش', callback_data: 'state_track' }],
            [{ text: '📱 برنامه‌های پیشنهادی', callback_data: 'menu_apps' }]
        ];
        return bot.editMessageText(welcomeMessage, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown' });
    }
    
    // --- ۲. مدیریت تمدید اشتراک ---
    if (data === 'state_renew') {
        userStates[chatId] = { step: 'waiting_for_renew_id' };
        return bot.editMessageText('لطفاً **شناسه تمدید (Renewal Identifier)** یا **لینک اشتراک** خود را ارسال کنید:', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ بازگشت', callback_data: 'menu_main' }]] }
        });
    }

    // --- ۳. مدیریت پیگیری سفارش ---
    if (data === 'state_track') {
        userStates[chatId] = { step: 'waiting_for_track_id' };
        return bot.editMessageText('لطفاً **شناسه پیگیری (Tracking ID)** خود را ارسال کنید:', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ بازگشت', callback_data: 'menu_main' }]] }
        });
    }


    // --- ۴. مدیریت منوی خرید اشتراک ---
    if (data === 'menu_purchase') {
        const keyboard = plansData.map(plan => 
            [{ text: `${plan.icon} ${plan.duration} - ${formatAmount(plan.baseAmount)} تومان`, callback_data: `plan_select_${plan.requestedPlan}` }]
        );
        keyboard.push([{ text: '⬅️ بازگشت به منو اصلی', callback_data: 'menu_main' }]);

        return bot.editMessageText('🛒 پلن مورد نظر خود را انتخاب کنید (قیمت‌ها برای ۱ کاربر است):', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: keyboard }
        });
    }

    // --- ۵. انتخاب پلن (ذخیره پلن و رفتن به انتخاب تعداد کاربر) ---
    if (data.startsWith('plan_select_')) {
        const requestedPlan = data.split('_')[2];
        
        // ذخیره پلن انتخاب شده در وضعیت کاربر
        userStates[chatId] = { 
            step: 'waiting_for_users', 
            requestedPlan: requestedPlan,
            // سایر مقادیر به صورت پیش‌فرض
            coupenCode: '',
            discountAmount: 0
        };

        const plan = plansData.find(p => p.requestedPlan === requestedPlan);
        
        // ساخت کیبورد انتخاب تعداد کاربر
        const userOptions = [1, 2, 3, 4, 5].map(users => {
            const originalAmount = calculateMultiUserPrice(plan.baseAmount, users);
            return {
                text: `${users} کاربر - ${formatAmount(originalAmount)} تومان`,
                callback_data: `users_select_${users}`
            };
        });

        // تقسیم دکمه‌ها در ردیف‌های دو تایی
        const keyboard = [];
        for (let i = 0; i < userOptions.length; i += 2) {
            const row = [userOptions[i]];
            if (userOptions[i + 1]) {
                row.push(userOptions[i + 1]);
            }
            keyboard.push(row);
        }

        keyboard.push([{ text: '⬅️ بازگشت به پلن‌ها', callback_data: 'menu_purchase' }]);

        return bot.editMessageText(`✅ پلن ${plan.duration} انتخاب شد. لطفاً تعداد کاربر مورد نیاز خود را انتخاب کنید (به ازای هر کاربر اضافه، ۵۰٪ قیمت پایه اضافه می‌شود):`, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: keyboard }
        });
    }

    // --- ۶. انتخاب تعداد کاربر (ذخیره و رفتن به درخواست کوپن) ---
    if (data.startsWith('users_select_')) {
        const users = data.split('_')[2];
        
        if (!userStates[chatId] || !userStates[chatId].requestedPlan) {
            return bot.editMessageText('❌ خطای داخلی: پلن انتخاب نشده است. لطفاً از منوی اصلی شروع کنید.', {
                 chat_id: chatId, 
                 message_id: messageId,
                 reply_markup: { inline_keyboard: [[{ text: '⬅️ بازگشت به منو اصلی', callback_data: 'menu_main' }]] }
             });
        }
        
        // ذخیره تعداد کاربران و تغییر وضعیت برای دریافت کوپن
        userStates[chatId].users = users;
        userStates[chatId].step = 'waiting_for_purchase_coupen';
        
        // پیام برای دریافت کوپن
        const coupenPrompt = 'لطفاً کد تخفیف خود را وارد کنید (اگر کد تخفیف ندارید، **0** را ارسال کنید):';
        
        return bot.editMessageText(coupenPrompt, {
             chat_id: chatId,
             message_id: messageId,
             reply_markup: { inline_keyboard: [[{ text: '⬅️ بازگشت به کاربران', callback_data: `plan_select_${userStates[chatId].requestedPlan}` }]] },
             parse_mode: 'Markdown'
         });
    }
    
    // --- ۷. مدیریت منوی برنامه‌ها ---
    if (data === 'menu_apps') {
        // ... (منطق نمایش برنامه‌ها) ...
        return bot.editMessageText('📱 لطفاً سیستم عامل خود را برای مشاهده برنامه‌های پیشنهادی انتخاب کنید:', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: appsMenu.inline_keyboard
        });
    }

    if (data.startsWith('apps_')) {
        // ... (منطق نمایش لینک‌های برنامه) ...
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
    
});