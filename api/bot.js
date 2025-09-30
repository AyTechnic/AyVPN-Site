const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const APP_URL = process.env.APP_URL;
const bot = new TelegramBot(TOKEN, { polling: true });

// NEW: مدیریت وضعیت کاربر برای ورودی‌های چند مرحله‌ای (برای تمدید و پیگیری) و ذخیره تعداد کاربر
const userStates = {};

// --- داده های ربات (ساختار بر اساس قیمت پایه ۱ کاربره) ---
// قیمت‌ها برای ۱ کاربر است و در زمان انتخاب پلن نهایی در بات در *تعداد کاربران* ضرب می‌شوند.
const plansData = [
    { duration: '۱ ماهه', baseAmount: 120000, durationDays: 30, type: 'unlimited', icon: '💎', requestedPlan: '1M' },
    { duration: '۲ ماهه', baseAmount: 220000, durationDays: 60, type: 'unlimited', icon: '🚀', requestedPlan: '2M' },
    { duration: '۳ ماهه', baseAmount: 340000, durationDays: 90, type: 'unlimited', icon: '🌟', requestedPlan: '3M' },
    { duration: '۶ ماهه', baseAmount: 600000, durationDays: 180, type: 'unlimited', icon: '🔥', requestedPlan: '6M' },
    { duration: '۱ ساله', baseAmount: 1000000, durationDays: 365, type: 'unlimited', icon: '🛡️', requestedPlan: '1Y' },
    { duration: '۲ ساله', baseAmount: 2000000, durationDays: 730, type: 'unlimited', icon: '👑', requestedPlan: '2Y' },
    
    // پلن‌های ملی
    { duration: '۱ ماهه ملی', baseAmount: 120000, durationDays: 30, type: 'national', icon: '🇮🇷', requestedPlan: '1M-N' },
    { duration: '۳ ماهه ملی', baseAmount: 340000, durationDays: 90, type: 'national', icon: '🇮🇷', requestedPlan: '3M-N' },
];

const plans = plansData.reduce((acc, p) => {
    const type = p.type;
    const text = `${p.icon} ${p.duration} (قیمت پایه: ${p.baseAmount.toLocaleString('fa-IR')} تومان)`; // نمایش قیمت پایه برای شفافیت
    const amount = p.baseAmount;
    
    if (!acc[type]) acc[type] = [];
    acc[type].push({ text, amount, requestedPlan: p.requestedPlan, type: type }); // ذخیره requestedPlan و type برای استفاده در callback
    return acc;
}, {});

// --- داده های برنامه‌ها ---
const apps = {
    android: [
        { text: 'Ay VPN Plus', url: 'https://t.me/Ay_VPN/62' },
        { text: 'v2rayNG', url: 'https://play.google.com/store/apps/details?id=com.v2ray.android' },
    ],
    ios: [
        { text: 'FoXray', url: 'https://apps.apple.com/us/app/foxray/id6477002517' },
        { text: 'Streisand', url: 'https://apps.apple.com/us/app/streisand/id6450534064' },
    ],
    windows: [
        { text: 'V2rayN', url: 'https://github.com/v2ray/v2rayN/releases' },
    ],
    mac: [
        { text: 'V2rayU', url: 'https://github.com/yanue/V2rayU/releases' },
    ]
};

const appsMenu = {
    inline_keyboard: [
        [{ text: '🤖 اندروید', callback_data: 'apps_android' }],
        [{ text: '🍎 iOS', callback_data: 'apps_ios' }],
        [{ text: '💻 ویندوز', callback_data: 'apps_windows' }],
        [{ text: '🍏 مک', callback_data: 'apps_mac' }],
        [{ text: '⬅️ بازگشت به منو اصلی', callback_data: 'menu_main' }]
    ]
};

const mainMenu = {
    inline_keyboard: [
        [{ text: '🛍️ خرید اشتراک جدید', callback_data: 'menu_buy_unlimited' }], // شروع از انتخاب نوع پلن -> انتخاب تعداد کاربر
        [{ text: '🔄 تمدید اشتراک', callback_data: 'menu_renew_info' }], 
        [{ text: '🔑 پیگیری سفارش', callback_data: 'menu_my_services' }], // پیگیری با Tracking ID
        [{ text: '📱 برنامه‌های مورد نیاز', callback_data: 'menu_apps' }],
        [{ text: '💬 ارتباط با پشتیبانی', url: 'https://t.me/AyVPNsupport' }],
    ]
};

// NEW: داده‌های تعداد کاربر (۱ تا ۸)
const userCounts = [1, 2, 3, 4, 5, 6, 7, 8];

// NEW: تابع ساخت کیبورد انتخاب تعداد کاربر
function userCountKeyboard(flowType, planType) {
    const keyboard = [];
    const firstRow = userCounts.slice(0, 4).map(u => ({
        text: `${u} کاربر`,
        // ساختار: select_users_{count}_{flowType}_{planType}
        callback_data: `select_users_${u}_${flowType}_${planType}` 
    }));
    const secondRow = userCounts.slice(4).map(u => ({
        text: `${u} کاربر`,
        callback_data: `select_users_${u}_${flowType}_${planType}`
    }));

    keyboard.push(firstRow);
    keyboard.push(secondRow);
    
    // دکمه بازگشت
    let backCallback = (flowType === 'new') ? `menu_buy_${planType}` : 'menu_main'; 
    if (flowType === 'renew') backCallback = 'menu_renew_info';
    
    keyboard.push([{ text: '⬅️ بازگشت', callback_data: backCallback }]);
    
    return { inline_keyboard: keyboard };
};


// تابع جداگانه برای نمایش منوی انتخاب پلن خرید جدید
function showBuyPlanMenu(chatId, messageId, state) {
    const users = state.users;
    const type = state.planType; // unlimited یا national
    const planList = plans[type] || plans.unlimited;
    
    const keyboard = planList.map(p => {
        // محاسبه مبلغ نهایی
        const finalAmount = p.amount * users;
        const text = `${p.text} (مبلغ نهایی: ${finalAmount.toLocaleString('fa-IR')} تومان)`;
        // ساختار: start_payment_plan_{type}_{requestedPlan}_{finalAmount}_{flowType}
        return [{ text: text, callback_data: `start_payment_plan_${p.type}_${p.requestedPlan}_${finalAmount}_new` }];
    });
    keyboard.push([{ text: '⬅️ بازگشت به انتخاب تعداد کاربر', callback_data: `menu_buy_${type}` }]);

    const messageText = `🛍️ پلن‌های ${type === 'unlimited' ? 'نامحدود' : 'ملی'} برای خرید جدید:
**تعداد کاربر انتخابی: ${users} نفر**

لطفاً پلن مورد نظر خود را انتخاب کنید:`;
    
    // تنظیم وضعیت به مرحله آخر تا ورودی متنی دیگر را نپذیرد
    userStates[chatId].step = 'FINAL_SELECTION'; 
    
    return bot.editMessageText(messageText, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'Markdown'
    });
}


// تابع جداگانه برای نمایش منوی انتخاب پلن تمدید
function showRenewalPlanMenu(chatId, messageId, state) {
    const renewalIdentifier = state.renewalIdentifier;
    const description = state.description || 'ندارد';
    const users = state.users;

    // تنظیم وضعیت به مرحله آخر تا ورودی متنی دیگر را نپذیرد
    userStates[chatId].step = 'FINAL_SELECTION';

    const allPlanList = [...plans.unlimited, ...plans.national].flat();
    
    const keyboard = allPlanList.map(p => {
        // محاسبه مبلغ نهایی
        const finalAmount = p.amount * users;
        const text = `${p.text} (مبلغ نهایی: ${finalAmount.toLocaleString('fa-IR')} تومان)`;
        // ساختار: start_payment_plan_{type}_{requestedPlan}_{finalAmount}_{flowType}
        return [{ text: text, callback_data: `start_payment_plan_${p.type}_${p.requestedPlan}_${finalAmount}_renew` }];
    });
    
    keyboard.push([{ text: '⬅️ بازگشت به انتخاب تعداد کاربر', callback_data: `go_to_user_count_renew` }]);
    keyboard.push([{ text: 'بازگشت به منو اصلی', callback_data: 'menu_main' }]);

    const messageText = `
**🔄 تمدید اشتراک**
-------------------
*شناسه تمدید:* \`${renewalIdentifier}\`
*توضیحات:* ${description}
**تعداد کاربر انتخابی: ${users} نفر**

لطفاً پلن مورد نظر خود را برای **تمدید** انتخاب کنید.
    `;

    // اگر messageId موجود است، پیام را ویرایش کن، در غیر این صورت پیام جدید بفرست
    if (messageId) {
        return bot.editMessageText(messageText, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'Markdown'
        });
    } else {
        return bot.sendMessage(chatId, messageText, {
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'Markdown'
        });
    }
}


// --- مدیریت ورودی‌های متنی (Text Listener) برای وضعیت‌های چند مرحله‌ای ---
bot.on('text', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // اگر کاربر در یک وضعیت خاص نیست یا دستور /start زد، کاری انجام نده
    if (!userStates[chatId] || text.startsWith('/')) {
        return; 
    }

    const currentState = userStates[chatId];

    // --- گام ۱: دریافت شناسه تمدید ---
    if (currentState.step === 'AWAITING_RENEWAL_ID') {
        const renewalIdentifier = text.trim();
        if (renewalIdentifier.length < 5) {
            return bot.sendMessage(chatId, '⚠️ شناسه وارد شده معتبر نیست. لطفاً لینک، ایمیل یا شماره تلفن صحیح خود را وارد کنید.');
        }
        
        userStates[chatId].renewalIdentifier = renewalIdentifier;
        userStates[chatId].step = 'AWAITING_RENEWAL_DESCRIPTION';

        const keyboard = [[{ text: '⏭️ بدون توضیحات ادامه بده', callback_data: 'renew_plan_selection_skip_desc' }]];

        return bot.sendMessage(chatId, 
            `✅ شناسه تمدید با موفقیت ثبت شد: \`${renewalIdentifier}\`

📌 **گام بعدی:** لطفاً اگر توضیحات یا درخواستی (اختیاری) در مورد تمدید دارید، آن را در یک پیام بنویسید.
یا از دکمه زیر برای رد شدن از این مرحله استفاده کنید.`, 
            {
                reply_markup: { inline_keyboard: keyboard },
                parse_mode: 'Markdown'
            });

    }

    // --- گام ۲: دریافت توضیحات اختیاری (تمدید) ---
    if (currentState.step === 'AWAITING_RENEWAL_DESCRIPTION') {
        userStates[chatId].description = text; // ذخیره توضیحات
        
        // پس از دریافت توضیحات، به منوی انتخاب تعداد کاربر هدایت می‌کنیم (جریان تمدید)
        userStates[chatId].step = 'AWAITING_USER_COUNT'; 
        userStates[chatId].planType = 'unlimited'; // فقط برای تعیین نوع بازگشت استفاده می‌شود
        
        return bot.sendMessage(chatId, 
            `✅ توضیحات ثبت شد.
            
**🔢 گام بعدی:** لطفاً تعداد کاربر مورد نظر خود را برای تمدید انتخاب کنید:`, 
            {
                reply_markup: userCountKeyboard('renew', 'unlimited'), 
                parse_mode: 'Markdown'
            });
    }
    
    // --- NEW: گام ۳: دریافت کد پیگیری (پیگیری سفارش) ---
    if (currentState.step === 'AWAITING_TRACKING_ID') {
        const trackingId = text.trim();
        if (trackingId.length < 5) {
            return bot.sendMessage(chatId, '⚠️ کد پیگیری وارد شده معتبر نیست. لطفاً کد را با دقت وارد کنید.');
        }

        try {
            const trackUrl = `${APP_URL}/api/track?trackingId=${trackingId}`;
            const response = await fetch(trackUrl);
            const purchases = await response.json();

            // حذف وضعیت بعد از عملیات
            delete userStates[chatId]; 
            
            if (purchases.error || purchases.length === 0) {
                const errorMessage = purchases.error || 'سفارشی با این کد پیگیری یافت نشد.';
                return bot.sendMessage(chatId, `❌ ${errorMessage}\n\nلطفاً کد را مجدداً بررسی کنید یا با پشتیبانی (@AyVPNsupport) تماس بگیرید.`, {
                    reply_markup: { inline_keyboard: [[{ text: '⬅️ بازگشت به منو اصلی', callback_data: 'menu_main' }]] },
                    parse_mode: 'Markdown'
                });
            }

            let messageText = `✅ **جزئیات سفارش شما** (کد پیگیری: \`${trackingId}\`)\n-------------------\n`;
            
            purchases.forEach((p, index) => {
                const linkText = p.link ? `[لینک اشتراک](${p.link})` : 'لینک یافت نشد (در صورت موفقیت آمیز بودن، لینک باید توسط پشتیبانی ارسال شود)';
                messageText += `\n**سفارش #${index + 1}**\n`;
                messageText += `*پلن:* ${p.plan}\n`;
                messageText += `*تاریخ:* ${p.date}\n`;
                messageText += `*لینک اتصال:* ${linkText}\n`;
                messageText += `*نام/ایمیل/تلفن:* ${p.name || p.email || p.phone || 'نامشخص'}\n`;
            });
            
            return bot.sendMessage(chatId, messageText, {
                reply_markup: { inline_keyboard: [[{ text: '⬅️ بازگشت به منو اصلی', callback_data: 'menu_main' }]] },
                parse_mode: 'Markdown'
            });

        } catch (error) {
            console.error('Tracking Error in bot:', error.message);
            delete userStates[chatId];
            return bot.sendMessage(chatId, '❌ خطای سرور در پیگیری سفارش. لطفاً بعداً تلاش کنید.', {
                reply_markup: { inline_keyboard: [[{ text: '⬅️ بازگشت به منو اصلی', callback_data: 'menu_main' }]] }
            });
        }
    }
});


// --- مدیریت دستور /start ---
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    // حذف وضعیت کاربر هنگام شروع مجدد
    delete userStates[chatId]; 

    const welcomeMessage = `
سلام ${msg.from.first_name}! 👋
به ربات Ay Technic خوش آمدید.

لطفاً گزینه مورد نظر خود را انتخاب کنید:
    `;
    bot.sendMessage(chatId, welcomeMessage, {
        reply_markup: mainMenu,
        parse_mode: 'Markdown'
    });
});

// --- مدیریت کلیک روی دکمه‌های Inline ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    const user = query.from;

    // ریست کردن وضعیت در صورت ورود به منو اصلی
    if (data === 'menu_main') {
        delete userStates[chatId];
        const welcomeMessage = `
سلام ${user.first_name}! 👋
به منو اصلی بازگشتید. لطفاً گزینه مورد نظر خود را انتخاب کنید:
        `;
        return bot.editMessageText(welcomeMessage, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: mainMenu,
            parse_mode: 'Markdown'
        });
    }

    // --- مدیریت پیگیری سفارش (گام ۱) ---
    if (data === 'menu_my_services') {
        userStates[chatId] = { step: 'AWAITING_TRACKING_ID' }; 
        return bot.editMessageText('🔑 لطفاً **کد پیگیری** (Tracking ID) دریافت شده از صفحه پرداخت یا ایمیل را وارد کنید:', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⬅️ بازگشت به منو اصلی', callback_data: 'menu_main' }]
                ]
            }
        });
    }

    // --- شروع فرآیند تمدید (گام ۱) ---
    if (data === 'menu_renew_info') {
        // تنظیم وضعیت به انتظار شناسه
        userStates[chatId] = { step: 'AWAITING_RENEWAL_ID' }; 
        return bot.editMessageText('🔄 لطفاً لینک اشتراک، ایمیل یا شماره تلفنی که با آن خرید قبلی را انجام داده‌اید، جهت تمدید وارد کنید:', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⬅️ بازگشت به منو اصلی', callback_data: 'menu_main' }]
                ]
            }
        });
    }

    // --- بازگشت از منوی پلن به انتخاب تعداد کاربر در جریان تمدید ---
    if (data === 'go_to_user_count_renew') {
        userStates[chatId].step = 'AWAITING_USER_COUNT';
        return bot.editMessageText(`**🔢 انتخاب تعداد کاربر:**

لطفاً تعداد کاربر مورد نظر خود را برای تمدید انتخاب کنید:`, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: userCountKeyboard('renew', 'unlimited'), 
            parse_mode: 'Markdown'
        });
    }


    // --- شروع فرآیند خرید جدید (گام ۱: انتخاب نوع پلن) ---
    if (data.startsWith('menu_buy_')) {
        delete userStates[chatId]; // اطمینان از حذف وضعیت تمدید
        const type = data.split('_')[2];
        
        // پس از انتخاب نوع پلن، به منوی انتخاب تعداد کاربر هدایت می‌کنیم
        userStates[chatId] = { 
            step: 'AWAITING_USER_COUNT', 
            planType: type // ذخیره نوع پلن (unlimited/national)
        }; 

        const messageText = `**🔢 گام اول: انتخاب تعداد کاربر**

شما پلن‌های ${type === 'unlimited' ? 'نامحدود' : 'ملی'} را انتخاب کردید.
لطفاً تعداد کاربر مورد نظر خود را انتخاب کنید:`;
        
        return bot.editMessageText(messageText, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: userCountKeyboard('new', type),
            parse_mode: 'Markdown'
        });
    }


    // --- مدیریت انتخاب تعداد کاربر (Callback: select_users_...) ---
    if (data.startsWith('select_users_')) {
        const parts = data.split('_');
        const users = parts[2]; // تعداد کاربر
        const flowType = parts[3]; // new یا renew
        const planType = parts[4]; // unlimited یا national (فقط برای new مهم است)
        
        userStates[chatId].users = users;
        userStates[chatId].step = 'FINAL_SELECTION'; 
        
        if (flowType === 'new') {
            // هدایت به منوی انتخاب پلن خرید جدید
            return showBuyPlanMenu(chatId, messageId, userStates[chatId]);
        } else if (flowType === 'renew') {
            // هدایت به منوی انتخاب پلن تمدید
            return showRenewalPlanMenu(chatId, messageId, userStates[chatId]);
        }
    }


    // --- رد شدن از توضیحات و رفتن به انتخاب تعداد کاربر (گام ۲.۵ تمدید) ---
    if (data === 'renew_plan_selection_skip_desc') {
        // چون این دکمه در وضعیت AWAITING_RENEWAL_DESCRIPTION ظاهر می‌شود
        const currentState = userStates[chatId];
        currentState.description = ''; // تنظیم توضیحات به خالی
        
        // پس از رد شدن از توضیحات، به منوی انتخاب تعداد کاربر هدایت می‌کنیم
        currentState.step = 'AWAITING_USER_COUNT'; 
        currentState.planType = 'unlimited'; 

        return bot.editMessageText(`✅ توضیحات ثبت شد (ندارد).
            
**🔢 گام بعدی:** لطفاً تعداد کاربر مورد نظر خود را برای تمدید انتخاب کنید:`, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: userCountKeyboard('renew', 'unlimited'), 
            parse_mode: 'Markdown'
        });
    }
    
    // --- مدیریت شروع پرداخت (Start Payment Logic) ---
    if (data.startsWith('start_payment_plan_')) {
        // ساختار جدید: start_payment_plan_{type}_{requestedPlan}_{amount}_{flowType}
        const parts = data.split('_');
        // parts[0]=start, [1]=payment, [2]=plan, [3]=type, [4]=requestedPlan (کد پلن), [5]=finalAmount, [6]=flowType
        const requestedPlan = parts[4]; 
        const amount = parts[5]; // این مبلغ نهایی محاسبه شده است
        const flowType = parts[6];
        const coupenCode = 'none'; // کوپن فعلا از اینجا اعمال نمی‌شود، مگر بعدا دکمه کوپن اضافه شود.
        
        // اطلاعات تلگرام
        const telegramUsername = user.username || 'N/A';
        const telegramId = chatId;

        // اطلاعات تمدید/کاربر از وضعیت کاربر
        const currentState = userStates[chatId] || {};
        const renewalIdentifier = flowType === 'renew' ? currentState.renewalIdentifier || 'Bot-Renewal' : '';
        const description = flowType === 'renew' ? currentState.description || '' : '';
        const users = currentState.users || '1'; // NEW: تعداد کاربر انتخابی
        
        // ساخت لینک پرداخت با پارامترهای جدید
        const paymentLink = `${APP_URL}/api/start-payment`;

        try {
            const response = await fetch(paymentLink, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount: amount,
                    description: `خرید/تمدید پلن ${requestedPlan} (${users} کاربر)`,
                    chat_id: telegramId,
                    name: user.first_name,
                    email: '', 
                    phone: '', 
                    renewalIdentifier: renewalIdentifier, 
                    requestedPlan: requestedPlan,
                    coupenCode: coupenCode,
                    telegramUsername: telegramUsername,
                    telegramId: telegramId,
                    users: users, // ارسال تعداد کاربر
                    description: description // ارسال توضیحات اختیاری
                }),
            });
            const result = await response.json();

            if (result.authority) {
                const zarinpalUrl = `https://www.zarinpal.com/pg/StartPay/${result.authority}`;
                
                const messageText = `
**💳 جزئیات پرداخت**
-------------------
*نوع فرآیند:* **${flowType === 'renew' ? 'تمدید اشتراک' : 'خرید اشتراک جدید'}**
*تعداد کاربر:* **${users} نفر**
*پلن انتخابی:* ${requestedPlan}
*مبلغ قابل پرداخت:* **${Number(amount).toLocaleString('fa-IR')} تومان**
*کوپن:* ${coupenCode === 'none' ? 'ندارد' : coupenCode}

لطفاً برای ادامه، روی دکمه پرداخت کلیک کنید.
                `;

                const keyboard = [
                    [{ text: '🔗 رفتن به صفحه پرداخت', url: zarinpalUrl }],
                    [{ text: '⬅️ بازگشت به منو اصلی', callback_data: 'menu_main' }],
                ];

                await bot.editMessageText(messageText, {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: { inline_keyboard: keyboard },
                    parse_mode: 'Markdown'
                });
            } else {
                bot.sendMessage(chatId, '❌ خطایی در اتصال به درگاه پرداخت رخ داد. لطفاً با پشتیبانی تماس بگیرید.');
            }
        } catch (error) {
            console.error('Start Payment Error:', error.message);
            bot.sendMessage(chatId, '❌ خطای سرور در شروع پرداخت. لطفاً بعداً تلاش کنید.');
        }

        // پس از شروع پرداخت، وضعیت تمدید/خرید را حذف می‌کنیم
        delete userStates[chatId];
    }
    
    
    // --- مدیریت منوی برنامه‌ها ---
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
});


// --- مدیریت خطای نظرسنجی ---
bot.on('polling_error', (error) => {
    // console.error(error.code); // => 'EFATAL'
});