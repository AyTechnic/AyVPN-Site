const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const APP_URL = process.env.APP_URL;
const bot = new TelegramBot(TOKEN);

// --- توابع کمکی جدید ---

const formatAmount = (amount) => amount.toLocaleString('fa-IR');

// تابع محاسبه قیمت چند کاربره
const calculateMultiUserPrice = (basePrice, users) => {
    // Price = Base Price + (Users - 1) * 50% of Base Price
    const multiplier = 1 + (users - 1) * 0.5;
    return Math.round(basePrice * multiplier / 1000) * 1000; // گرد کردن به نزدیکترین ۱۰۰۰ تومان
};


// --- داده های ربات (اضافه شدن code) ---
const plans = {
    unlimited: [
        { text: '💎 ۱ ماهه - ۱۲۰,۰۰۰ تومان', code: '30D', amount: 120000 },
        { text: '🚀 ۲ ماهه - ۲۲۰,۰۰۰ تومان', code: '60D', amount: 220000 },
        { text: '🌟 ۳ ماهه - ۳۴۰,۰۰۰ تومان', code: '90D', amount: 340000 },
        { text: '🔥 ۶ ماهه - ۶۰۰,۰۰۰ تومان', code: '180D', amount: 600000 },
        { text: '🛡️ ۱ ساله - ۱,۰۰۰,۰۰۰ تومان', code: '365D', amount: 1000000 },
        { text: '👑 ۲ ساله - ۲,۰۰۰,۰۰۰ تومان', code: '730D', amount: 2000000 },
    ],
    national: [
        { text: '🇮🇷 ۱ ماهه ملی - ۱۲۰,۰۰۰ تومان', code: '30D', amount: 120000 },
        { text: '🇮🇷 ۳ ماهه ملی - ۳۴۰,۰۰۰ تومان', code: '90D', amount: 340000 },
    ]
};

const apps = {
    android: [
        { text: 'Ay VPN Plus', url: 'https://t.me/Ay_VPN/62' },
        { text: 'v2rayNG', url: 'https://t.me/Ay_VPN/61' },
        { text: 'NapsternetV', url: 'https://t.me/Ay_VPN/60' },
        { text: 'Happ', url: 'https://t.me/Ay_VPN/59' },
    ],
    ios: [
        { text: 'Streisand', url: 'https://apps.apple.com/app/streisand/id6450534064' },
        { text: 'V2Box', url: 'https://apps.apple.com/app/v2box-v2ray-client/id6446814690' },
        { text: 'Happ', url: 'https://t.me/Ay_VPN/58' },
    ],
    windows: [
        { text: 'Nekoray', url: 'https://t.me/Ay_VPN/57' },
        { text: 'V2RayN', url: 'https://t.me/Ay_VPN/56' },
    ]
};

// --- متغیر برای مدیریت وضعیت کاربر در ربات ---
let userStates = {};

// --- توابع کمکی ---

// تابع کمکی برای گرفتن کیبورد منوی اصلی (شامل «سرویس‌های من» در صورت وجود سابقه خرید)
async function getMainMenuKeyboard(chatId, checkHistory = true) {
    let hasHistory = false;
    if (checkHistory) {
         try {
            // تماس با یک endpoint جدید یا verify.js برای بررسی تاریخچه
            const historyResponse = await fetch(`${APP_URL}/api/verify?action=history&chat_id=${chatId}`);
            const history = await historyResponse.json();
            hasHistory = history && history.length > 0;
        } catch (error) {
            console.error('Error fetching history for main menu:', error);
        }
    }
    
    const menu = [
        [{ text: '💎 اشتراک نامحدود | ثابت 💎', callback_data: 'menu_buy_unlimited' }],
        [{ text: '🇮🇷 اشتراک اینترنت ملی 🇮🇷', callback_data: 'menu_buy_national' }],
        [{ text: '🔄 تمدید اشتراک قبلی', callback_data: 'menu_renew' }],
        ...(hasHistory ? [[{ text: '📜 سرویس‌های من', callback_data: 'menu_my_services' }]] : []), // قابلیت جدید
        [{ text: '📱 برنامه های اتصال', callback_data: 'menu_apps' }],
    ];
    
    return { reply_markup: { inline_keyboard: menu } };
}

const appsMenu = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🤖 اندروید', callback_data: 'apps_android' }, { text: '🍏 آیفون', callback_data: 'apps_ios' }],
            [{ text: '💻 ویندوز', callback_data: 'apps_windows' }],
            [{ text: '🎓 آموزش اتصال', url: 'https://t.me/Ay_VPN' }],
            [{ text: '⬅️ بازگشت به منوی اصلی', callback_data: 'menu_main' }],
        ]
    }
};

const backToMainMenuBtn = [[{ text: '⬅️ بازگشت به منوی اصلی', callback_data: 'menu_main' }]];
const backToAppsMenuBtn = [[{ text: '⬅️ بازگشت به برنامه‌ها', callback_data: 'menu_apps' }]];

// --- تابع اصلی ربات ---
module.exports = async (req, res) => {
    const update = req.body;
    try {
        if (update.message) {
            await handleMessage(update.message);
        }
        if (update.callback_query) {
            await handleCallbackQuery(update.callback_query);
        }
    } catch (error) {
        console.error('Bot Main Handler Error:', error);
    }
    res.status(200).send('OK');
};

// --- مدیریت پیام‌ها ---
async function handleMessage(message) {
    const chatId = message.chat.id;
    const text = message.text;

    if (text === '/start') {
        const mainKeyboard = await getMainMenuKeyboard(chatId);
        await bot.sendMessage(chatId, `سلام، به ربات خرید و تمدید اشتراک ${'Ay Technic'} خوش آمدید.`, mainKeyboard);
        userStates[chatId] = { state: 'main_menu', chatId, username: message.chat.username };
        return;
    }

    // --- مدیریت ورودی کوپن ---
    if (userStates[chatId] && userStates[chatId].state === 'awaiting_coupon') {
        const couponCode = text.trim();
        const userState = userStates[chatId];
        const { type, requestedPlan, baseAmount, users, renewalId } = userState; // NEW: Get baseAmount and users
        const isRenewal = renewalId !== 'none';
        
        // 1. Check coupon validity and calculate discount
        let couponCheckResult;
        try {
            // NEW: Send final calculated amount for coupon check
            const finalMultiUserAmount = calculateMultiUserPrice(parseInt(baseAmount), parseInt(users));
            const checkCouponResponse = await fetch(`${APP_URL}/api/verify?action=check_coupon&couponCode=${couponCode}&amount=${finalMultiUserAmount}`);
            couponCheckResult = await checkCouponResponse.json();
        } catch (error) {
            console.error('Coupon Check API Error:', error);
            await bot.sendMessage(chatId, '❌ خطا در بررسی کوپن. لطفاً مجدداً امتحان کنید.', { reply_markup: { inline_keyboard: backToMainMenuBtn } });
            delete userStates[chatId];
            return;
        }

        if (couponCheckResult.error) {
            await bot.sendMessage(chatId, `❌ **خطا:** ${couponCheckResult.error}\n\nلطفاً کد دیگری وارد کنید یا دکمه «بدون کوپن» را بزنید.`, { parse_mode: 'Markdown' });
            return; // Stay in awaiting_coupon state
        }
        
        // 2. Coupon is valid
        const finalAmount = couponCheckResult.finalAmount;
        const discountAmount = calculateMultiUserPrice(parseInt(baseAmount), parseInt(users)) - finalAmount;
        
        // Final payment callback
        let paymentCallback = `start_payment_${requestedPlan}_${finalAmount}_none_${users}`; // NEW: Add users
        if (isRenewal) {
            paymentCallback = `start_payment_${requestedPlan}_${finalAmount}_${renewalId}_${users}_renew`; // NEW: Add users and renew flag
        }

        const messageText = `
            ✅ **کوپن با موفقیت اعمال شد!**
            🔹 **مقدار تخفیف:** ${formatAmount(discountAmount)} تومان
            💳 **مبلغ قابل پرداخت نهایی:** **${formatAmount(finalAmount)} تومان**
            
            لطفاً برای تکمیل خرید/تمدید، دکمه پرداخت را بزنید.
        `;

        const keyboard = [
            [{ text: `💳 پرداخت نهایی (${formatAmount(finalAmount)} تومان)`, callback_data: paymentCallback }],
            [{ text: '⬅️ بازگشت و حذف کوپن', callback_data: isRenewal ? `renew_plan_${type}_${plans[type].findIndex(p => p.code === requestedPlan)}_${renewalId}` : `buy_${type}_${plans[type].findIndex(p => p.code === requestedPlan)}` }], // Go back to plan selection (before users)
        ];
        
        // If renewal, the back button should return to the select users step
        const originalPlan = plans[type].find(p => p.code === requestedPlan);
        const originalUsersCallback = `users_selected_1_${type}_${requestedPlan}_${originalPlan.amount}${isRenewal ? '_' + renewalId : ''}`; // Default to 1 user for back

        keyboard[1] = [{ text: '⬅️ بازگشت و حذف کوپن', callback_data: originalUsersCallback }];

        userStates[chatId].state = 'plan_selected'; // Reset state
        await bot.sendMessage(chatId, messageText, { 
            reply_markup: { inline_keyboard: keyboard }, 
            parse_mode: 'Markdown' 
        });

        return;
    }
}

// --- مدیریت Callback Query ---
async function handleCallbackQuery(callbackQuery) {
    const data = callbackQuery.data;
    const message = callbackQuery.message;
    const chatId = message.chat.id;
    const messageId = message.message_id;
    
    // Default action: acknowledge the button press
    await bot.answerCallbackQuery(callbackQuery.id);

    // --- مدیریت منوهای اصلی ---
    if (data === 'menu_main') {
        const mainKeyboard = await getMainMenuKeyboard(chatId, false);
        return bot.editMessageText(`سلام، به ربات خرید و تمدید اشتراک ${'Ay Technic'} خوش آمدید.`, {
            chat_id: chatId,
            message_id: messageId,
            ...mainKeyboard
        });
    }

    if (data.startsWith('menu_buy_')) {
        const type = data.split('_')[2];
        const planList = plans[type];
        
        const messageText = `لطفاً پلن ${type === 'unlimited' ? 'نامحدود' : 'ملی'} مورد نظر خود را انتخاب کنید:`;
        
        const keyboard = planList.map((p, i) => ([
            // callback: buy_TYPE_INDEX
            { text: p.text, callback_data: `buy_${type}_${i}` }
        ]));
        
        keyboard.push([{ text: '⬅️ بازگشت به منوی اصلی', callback_data: 'menu_main' }]);
        
        return bot.editMessageText(messageText, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: keyboard }
        });
    }

    // --- ۱. انتخاب پلن (خرید جدید) - NEW FLOW STEP ---
    if (data.startsWith('buy_') && data.split('_').length === 3) {
        const parts = data.split('_'); // parts: [buy, unlimited, index]
        const type = parts[1]; // 'unlimited' or 'national'
        const planIndex = parseInt(parts[2]);
        const plan = plans[type][planIndex];

        const requestedPlanCode = plan.code;
        const baseAmount = plan.amount;
        const messageText = `✅ **پلن انتخابی:** ${plan.text}\n\n⬅️ حالا تعداد کاربران مورد نیاز را انتخاب کنید (۱ تا ۸ کاربر):`;

        const userKeyboard = [];
        for (let i = 1; i <= 8; i++) {
            const finalAmount = calculateMultiUserPrice(baseAmount, i);
            // callback: users_selected_COUNT_TYPE_CODE_BASEAMOUNT
            userKeyboard.push({ 
                text: `${i} کاربره - ${formatAmount(finalAmount)} تومان`, 
                callback_data: `users_selected_${i}_${type}_${requestedPlanCode}_${baseAmount}` 
            });
        }

        const inlineKeyboard = [
            userKeyboard.slice(0, 4), // 1-4
            userKeyboard.slice(4, 8), // 5-8
            [{ text: '⬅️ بازگشت به پلن‌ها', callback_data: `menu_buy_${type}` }],
        ];

        return bot.editMessageText(messageText, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: inlineKeyboard },
            parse_mode: 'Markdown'
        });
    }

    // --- ۲. مدیریت تمدید: درخواست شناسه ---
    if (data === 'menu_renew') {
        userStates[chatId] = { state: 'awaiting_renewal_id', chatId, username: message.chat.username };
        return bot.editMessageText('لطفاً **شناسه اشتراک قبلی** خود (کد پیگیری) را برای تمدید ارسال کنید:', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: backToMainMenuBtn }
        });
    }

    // --- ۳. مدیریت تمدید: انتخاب پلن پس از ورود شناسه ---
    if (data.startsWith('renew_id_')) {
        const renewalId = data.split('_')[2];
        
        // Prompt for plan selection for renewal
        const messageText = `✅ **شناسه ${renewalId} پذیرفته شد.**\n\nلطفاً پلن جدید مورد نظر خود را برای تمدید انتخاب کنید:`;
        
        const keyboardUnlimited = plans.unlimited.map((p, i) => ([
            // callback: renew_plan_TYPE_INDEX_RENEWALID
            { text: p.text, callback_data: `renew_plan_unlimited_${i}_${renewalId}` }
        ]));
        
        const keyboardNational = plans.national.map((p, i) => ([
            { text: p.text, callback_data: `renew_plan_national_${i}_${renewalId}` }
        ]));

        const inlineKeyboard = [
            ...keyboardUnlimited,
            ...keyboardNational,
            [{ text: '⬅️ بازگشت به منوی اصلی', callback_data: 'menu_main' }]
        ];
        
        return bot.editMessageText(messageText, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: inlineKeyboard },
            parse_mode: 'Markdown'
        });
    }

    // --- ۴. مدیریت تمدید: انتخاب تعداد کاربر - NEW FLOW STEP ---
    if (data.startsWith('renew_plan_')) {
        const parts = data.split('_'); // parts: [renew, plan, unlimited, index, renewalId]
        const type = parts[2]; // 'unlimited' or 'national'
        const planIndex = parseInt(parts[3]);
        const renewalId = parts[4];
        const plan = plans[type][planIndex];
        
        const requestedPlanCode = plan.code;
        const baseAmount = plan.amount;
        
        const messageText = `✅ **پلن انتخابی برای تمدید:** ${plan.text}\n\n⬅️ حالا تعداد کاربران مورد نیاز را انتخاب کنید (۱ تا ۸ کاربر):`;

        const userKeyboard = [];
        for (let i = 1; i <= 8; i++) {
            const finalAmount = calculateMultiUserPrice(baseAmount, i);
            // callback: users_selected_COUNT_TYPE_CODE_BASEAMOUNT_RENEWALID
            userKeyboard.push({ 
                text: `${i} کاربره - ${formatAmount(finalAmount)} تومان`, 
                callback_data: `users_selected_${i}_${type}_${requestedPlanCode}_${baseAmount}_${renewalId}` 
            });
        }
        
        const inlineKeyboard = [
            userKeyboard.slice(0, 4), // 1-4
            userKeyboard.slice(4, 8), // 5-8
            [{ text: '⬅️ بازگشت به پلن‌ها', callback_data: `renew_id_${renewalId}` }],
        ];

        return bot.editMessageText(messageText, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: inlineKeyboard },
            parse_mode: 'Markdown'
        });
    }

    // --- ۵. انتخاب تعداد کاربر و نمایش قیمت نهایی - NEW FLOW STEP ---
    if (data.startsWith('users_selected_')) {
        // data structure: users_selected_COUNT_TYPE_CODE_BASEAMOUNT(_RENEWALID)
        const parts = data.split('_');
        const users = parts[2];
        const type = parts[3];
        const requestedPlanCode = parts[4];
        const baseAmount = parseInt(parts[5]);
        const renewalId = parts.length > 6 ? parts[6] : 'none';
        const isRenewal = renewalId !== 'none';

        const finalAmount = calculateMultiUserPrice(baseAmount, users);
        const planDurationText = plans[type].find(p => p.code === requestedPlanCode).text.split('-')[0].trim();
        const finalAmountText = formatAmount(finalAmount);

        const messageText = `
            💰 **خرید/تمدید نهایی**
            🔹 **پلن انتخابی:** ${planDurationText}
            👥 **تعداد کاربران:** ${users} کاربره
            💵 **قیمت پایه:** ${formatAmount(baseAmount)} تومان
            💳 **مبلغ قابل پرداخت:** **${finalAmountText} تومان**
            
            در صورت داشتن کد تخفیف، آن را اعمال کنید.
        `;

        // Payment callback: start_payment_CODE_FINALAMOUNT_RENEWALID_USERS(_RENEW)
        let paymentCallback = `start_payment_${requestedPlanCode}_${finalAmount}_${renewalId}_${users}`;
        if (isRenewal) {
            paymentCallback += '_renew';
        }
        
        // Coupon callback: enter_coupon_code_TYPE_CODE_BASEAMOUNT_USERS(_RENEW_RENEWALID)
        let couponCallback = `enter_coupon_code_${type}_${requestedPlanCode}_${baseAmount}_${users}`;
        if (isRenewal) {
            couponCallback += `_renew_${renewalId}`;
        }
        
        // Back button: Go back to select users (this same step, but for one user)
        const backCallback = data.replace('users_selected_', 'buy_plan_users_'); // Replaced below with logic
        
        const keyboard = [
            [{ text: '🛍️ کد تخفیف دارم', callback_data: couponCallback }],
            [{ text: '💳 رفتن به صفحه پرداخت (بدون کوپن)', callback_data: paymentCallback }],
        ];

        // Find index of plan by code to create the back button to plan selection (before users)
        const planIndex = plans[type].findIndex(p => p.code === requestedPlanCode);
        const planSelectionCallback = isRenewal ? `renew_plan_${type}_${planIndex}_${renewalId}` : `buy_${type}_${planIndex}`;

        keyboard.push([{ text: '⬅️ بازگشت به انتخاب پلن', callback_data: planSelectionCallback }]);

        userStates[chatId] = { state: 'plan_selected', chatId, username: message.chat.username }; // Reset state for payment/coupon flow

        return bot.editMessageText(messageText, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'Markdown'
        });
    }

    // --- ۶. مدیریت درخواست ورود کوپن ---
    if (data.startsWith('enter_coupon_code_')) {
        // data structure: enter_coupon_code_TYPE_CODE_BASEAMOUNT_USERS(_RENEW_RENEWALID)
        const parts = data.split('_');
        const type = parts[3];
        const requestedPlanCode = parts[4];
        const baseAmount = parts[5];
        const users = parts[6];
        const isRenewal = parts[7] === 'renew';
        const renewalId = isRenewal ? parts[8] : 'none';

        // Store state to handle the next message
        userStates[chatId] = { 
            state: 'awaiting_coupon', 
            type, 
            requestedPlan: requestedPlanCode, 
            baseAmount, // Base amount of the plan (e.g., 120000)
            users, // Number of users selected
            renewalId, 
        };
        
        // The final amount before coupon check
        const currentFinalAmount = calculateMultiUserPrice(parseInt(baseAmount), parseInt(users));

        const messageText = `
            🛍️ **اعمال کد تخفیف**
            
            🔹 **مبلغ نهایی برای تخفیف:** ${formatAmount(currentFinalAmount)} تومان
            
            لطفاً کد تخفیف خود را ارسال کنید:
        `;

        const keyboard = [
            // Go back to the user selection summary (default one user)
            [{ text: '⬅️ بازگشت و حذف کوپن', callback_data: `users_selected_${users}_${type}_${requestedPlanCode}_${baseAmount}${isRenewal ? '_' + renewalId : ''}` }],
        ];

        return bot.editMessageText(messageText, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'Markdown'
        });
    }


    // --- ۷. شروع فرایند پرداخت (start-payment) - MODIFIED: ADD USERS ---
    if (data.startsWith('start_payment_')) {
        // data structure: start_payment_CODE_FINALAMOUNT_RENEWALID_USERS(_RENEW)
        const parts = data.split('_');
        const requestedPlan = parts[2];
        const amount = parseInt(parts[3]);
        const renewalId = parts[4] === 'none' ? '' : parts[4];
        const users = parts[5]; // NEW: get users count
        const isRenewal = parts.length > 6 && parts[6] === 'renew';
        const couponCode = parts.length > 7 && parts[7] !== 'none' ? parts[7] : ''; // Check for coupon (if applicable)

        // Ensure user info is available (basic check)
        if (!userStates[chatId] || !userStates[chatId].email) {
            // Need to prompt for user info if not already done in the flow
            userStates[chatId] = { ...userStates[chatId], state: 'awaiting_user_info' };
            await bot.sendMessage(chatId, 'لطفاً ایمیل خود را برای شروع فرآیند پرداخت وارد کنید:');
            // Re-queue the payment request after info is received
            userStates[chatId].nextAction = { data }; 
            return;
        }

        // 1. Send request to start-payment API
        const body = {
            amount,
            description: isRenewal ? 'تمدید اشتراک' : 'خرید اشتراک جدید',
            chat_id: chatId,
            name: userStates[chatId].name || 'ربات تلگرام',
            email: userStates[chatId].email,
            phone: userStates[chatId].phone || '',
            renewalIdentifier: renewalId,
            requestedPlan: requestedPlan,
            coupenCode: couponCode,
            users: users, // NEW: Include users count
        };

        let result;
        try {
            const response = await fetch(`${APP_URL}/api/start-payment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            result = await response.json();
        } catch (error) {
            console.error('API Error:', error);
            return bot.editMessageText('❌ خطا در ارتباط با درگاه پرداخت. لطفاً دقایقی دیگر امتحان کنید.', { chat_id: chatId, message_id: messageId });
        }

        if (result.authority) {
            const paymentUrl = `https://www.zarinpal.com/pg/StartPay/${result.authority}`;
            const keyboard = [
                [{ text: '💳 رفتن به صفحه پرداخت', url: paymentUrl }],
                [{ text: '⬅️ بازگشت به منوی اصلی', callback_data: 'menu_main' }]
            ];
            
            return bot.editMessageText('✅ لینک پرداخت ایجاد شد. لطفاً برای تکمیل خرید خود اقدام کنید:', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: keyboard }
            });
        } else {
            return bot.editMessageText(`❌ خطا در ایجاد لینک پرداخت: ${result.error || 'خطای ناشناخته'}`, { chat_id: chatId, message_id: messageId });
        }
    }


    // --- ۸. مدیریت منوی برنامه‌ها - MODIFIED: SEND LINK AS MESSAGE ---
    if (data === 'menu_apps') {
        return bot.editMessageText('📱 لطفاً سیستم عامل خود را برای مشاهده برنامه‌های پیشنهادی انتخاب کنید:', {
            chat_id: chatId,
            message_id: messageId,
            ...appsMenu
        });
    }

    if (data.startsWith('apps_')) {
        const type = data.split('_')[1];
        const appList = apps[type];
        
        let messageText = `✅ برنامه‌های پیشنهادی برای ${type}:\n\n`;
        
        // Change from inline URL buttons to sending the links as text in the message
        appList.forEach(a => {
            messageText += `*${a.text}*: ${a.url}\n`;
        });

        return bot.editMessageText(messageText, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: backToAppsMenuBtn }, // Only show back button
            parse_mode: 'Markdown'
        });
    }
}