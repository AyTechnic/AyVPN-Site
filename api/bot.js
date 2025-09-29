const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const APP_URL = process.env.APP_URL;
const bot = new TelegramBot(TOKEN);

// یک شیء برای ذخیره وضعیت کاربر، به خصوص در زمان انتظار برای کد تخفیف
const userState = {};

// --- داده های ربات ---
const plans = {
    unlimited: [
        { text: '💎 ۱ ماهه - ۱۲۰,۰۰۰ تومان', amount: 120000, duration: '۱ ماهه' },
        { text: '🚀 ۲ ماهه - ۲۲۰,۰۰۰ تومان', amount: 220000, duration: '۲ ماهه' },
        { text: '🌟 ۳ ماهه - ۳۴۰,۰۰۰ تومان', amount: 340000, duration: '۳ ماهه' },
        { text: '🔥 ۶ ماهه - ۶۰۰,۰۰۰ تومان', amount: 600000, duration: '۶ ماهه' },
        { text: '🛡️ ۱ ساله - ۱,۰۰۰,۰۰۰ تومان', amount: 1000000, duration: '۱ ساله' },
        { text: '👑 ۲ ساله - ۲,۰۰۰,۰۰۰ تومان', amount: 2000000, duration: '۲ ساله' },
    ],
    national: [ // Placeholder plans
        { text: '🇮🇷 ۱ ماهه ملی - ۱۲۰,۰۰۰ تومان', amount: 120000, duration: '۱ ماهه ملی' },
        { text: '🇮🇷 ۳ ماهه ملی - ۳۴۰,۰۰۰ تومان', amount: 340000, duration: '۳ ماهه ملی' },
    ]
};

// FIX: Change 'url' to 'link' and remove URL type from keyboard
const apps = {
    android: [
        { text: 'Ay VPN Plus', link: 'https://t.me/Ay_VPN/62' },
        { text: 'v2rayNG', link: 'https://t.me/Ay_VPN/120' },
    ],
    ios: [
        { text: 'Foxray', link: 'https://t.me/Ay_VPN/88' },
        { text: 'Shadowrocket', link: 'https://t.me/Ay_VPN/89' },
    ],
    windows: [
        { text: 'V2rayN', link: 'https://t.me/Ay_VPN/15' },
    ],
    mac: [
        { text: 'V2rayU', link: 'https://t.me/Ay_VPN/16' },
    ]
};

// --- منوهای اصلی ---
const mainMenu = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🛒 خرید اشتراک', callback_data: 'menu_buy' }],
            [{ text: '🔄 تمدید اشتراک', callback_data: 'menu_renew' }],
            [{ text: '📱 برنامه‌های مورد نیاز', callback_data: 'menu_apps' }],
            [{ text: '❓ راهنمای اتصال', url: 'https://t.me/Ay_VPN/1' }],
        ]
    }
};

const buyMenu = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🌎 نامحدود', callback_data: 'menu_buy_unlimited' }, { text: '🇮🇷 ملی', callback_data: 'menu_buy_national' }],
            [{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'main_menu' }],
        ]
    }
};

const appsMenu = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🤖 اندروید', callback_data: 'apps_android' }, { text: '🍏 آی‌اواس/آیفون', callback_data: 'apps_ios' }],
            [{ text: '💻 ویندوز', callback_data: 'apps_windows' }, { text: '🍎 مک', callback_data: 'apps_mac' }],
            [{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'main_menu' }],
        ]
    }
};

// تابع ساخت کیبورد پلن‌ها
const createPlansKeyboard = (planType) => {
    const planList = plans[planType];
    const keyboard = planList.map(p => ([{
        text: p.text,
        // callback: plan_selected_[planType]_[amount]
        callback_data: `plan_selected_${planType}_${p.amount}`
    }]));

    keyboard.push([{ text: '🔙 بازگشت به منوی خرید', callback_data: 'menu_buy' }]);
    return { inline_keyboard: keyboard };
};

// تابع ساخت کیبورد انتخاب تعداد کاربر
const userCountKeyboard = (planType, requestedPlan, renewalId = '') => {
    const keyboard = [];
    // دکمه‌های ۱ تا ۸ کاربر
    for (let i = 1; i <= 8; i++) {
        // callback: user_count_selected_[planType]_[requestedPlan]_[renewalId (optional)]_[userCount]
        keyboard.push({ text: `${i} کاربره`, callback_data: `${renewalId ? 'renew_' : ''}user_count_selected_${planType}_${requestedPlan}_${renewalId}_${i}` });
    }
    
    // تقسیم بندی ۴ تایی در هر سطر
    const inlineKeyboard = [
        keyboard.slice(0, 4), 
        keyboard.slice(4, 8)
    ];

    // دکمه بازگشت
    inlineKeyboard.push([{ text: '⬅️ بازگشت به پلن‌ها', callback_data: renewalId ? 'menu_renew' : `menu_buy_${planType}` }]);
    
    return { inline_keyboard: inlineKeyboard };
};


// ------------------- مدیریت دستورات -------------------
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '✋ سلام. به ربات فروشگاه اشتراک Ay VPN خوش آمدید.\n\nلطفاً گزینه مورد نظر خود را انتخاب کنید:', mainMenu);
});

// ------------------- مدیریت Callback Query -------------------
bot.on('callback_query', async (callbackQuery) => {
    const data = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;

    // --- مدیریت منوی اصلی و خرید ---
    if (data === 'main_menu') {
        return bot.editMessageText('لطفاً گزینه مورد نظر خود را انتخاب کنید:', {
            chat_id: chatId,
            message_id: messageId,
            ...mainMenu
        });
    }

    if (data === 'menu_buy') {
        return bot.editMessageText('🛒 لطفاً نوع اشتراک مورد نظر خود را انتخاب کنید:', {
            chat_id: chatId,
            message_id: messageId,
            ...buyMenu
        });
    }

    if (data.startsWith('menu_buy_')) {
        const planType = data.split('_')[2];
        const typeText = planType === 'unlimited' ? 'نامحدود' : 'ملی';
        return bot.editMessageText(`🌐 پلن‌های ${typeText} را مشاهده می‌کنید:\n\nلطفاً پلن مورد نظر خود را انتخاب کنید:`, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: createPlansKeyboard(planType)
        });
    }
    
    // --- مدیریت انتخاب پلن (خرید) ---
    if (data.startsWith('plan_selected_')) {
        const [_, planType, requestedPlan] = data.split('_');
        const plan = plans[planType].find(p => p.amount.toString() === requestedPlan);

        const messageText = `اشتراک **${plan.duration}** انتخاب شد.\n\nلطفاً **تعداد کاربران** مورد نظر خود را انتخاب کنید:`;

        return bot.editMessageText(messageText, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: userCountKeyboard(planType, requestedPlan), // مرحله جدید: انتخاب تعداد کاربر
            parse_mode: 'Markdown'
        });
    }
    
    // --- مدیریت انتخاب تعداد کاربر (خرید) ---
    if (data.startsWith('user_count_selected_')) {
        const [_, planType, requestedPlan, userCountStr] = data.split('_');
        const userCount = Number(userCountStr);
        const plan = plans[planType].find(p => p.amount.toString() === requestedPlan);
        const baseAmount = Number(plan.amount);
        
        // محاسبه قیمت چند کاربره: 50% به ازای هر کاربر اضافه
        const extraUsers = userCount - 1;
        const priceMultiplier = 1 + (extraUsers * 0.5);
        const finalAmount = Math.round(baseAmount * priceMultiplier);

        const messageText = `✅ **پلن ${plan.duration} (${userCount} کاربره) انتخاب شد**\n\nمبلغ پایه: ${baseAmount.toLocaleString('fa-IR')} تومان\nهزینه ${extraUsers} کاربر اضافه (۵۰٪): ${(finalAmount - baseAmount).toLocaleString('fa-IR')} تومان\n\n**مبلغ قابل پرداخت:** **${finalAmount.toLocaleString('fa-IR')} تومان**`;

        const keyboard = [
            // callback: enter_coupon_code_[planType]_[requestedPlan (base price)]_[finalAmount]_[userCount]_[actionType (buy)]
            [{ text: '🛍️ کد تخفیف دارم', callback_data: `enter_coupon_code_${planType}_${requestedPlan}_${finalAmount}_${userCount}_buy` }],
            // callback: start_payment_[requestedPlan (base price)]_[finalAmount]_[userCount]_[couponCode (none)]
            [{ text: '💳 رفتن به صفحه پرداخت (بدون کوپن)', callback_data: `start_payment_${requestedPlan}_${finalAmount}_${userCount}_none` }],
            // بازگشت به منوی انتخاب کاربران
            [{ text: '⬅️ بازگشت به کاربران', callback_data: `plan_selected_${planType}_${requestedPlan}` }],
        ];

        return bot.editMessageText(messageText, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'Markdown'
        });
    }

    // --- مدیریت منوی تمدید ---
    if (data === 'menu_renew') {
        return bot.editMessageText('لطفاً شناسه اشتراک خود را برای تمدید ارسال کنید:', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'main_menu' }],
                ]
            }
        });
    }
    
    // --- مدیریت تمدید (پس از دریافت شناسه) ---
    if (data.startsWith('plan_selected_renew_')) {
        const [_, planType, requestedPlan, renewalId] = data.split('_');
        const plan = plans[planType].find(p => p.amount.toString() === requestedPlan);

        const messageText = `شناسه تمدید: **${renewalId}**\nاشتراک تمدیدی **${plan.duration}** انتخاب شد.\n\nلطفاً **تعداد کاربران** مورد نظر خود را انتخاب کنید:`;
        
        // مرحله جدید: انتخاب تعداد کاربر برای تمدید
        return bot.editMessageText(messageText, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: userCountKeyboard(planType, requestedPlan, renewalId),
            parse_mode: 'Markdown'
        });
    }
    
    // --- مدیریت انتخاب تعداد کاربر (تمدید) ---
    if (data.startsWith('renew_user_count_selected_')) {
        const [_, planType, requestedPlan, renewalId, userCountStr] = data.split('_');
        const userCount = Number(userCountStr);
        const plan = plans[planType].find(p => p.amount.toString() === requestedPlan);
        const baseAmount = Number(plan.amount);
        
        // محاسبه قیمت چند کاربره
        const extraUsers = userCount - 1;
        const priceMultiplier = 1 + (extraUsers * 0.5);
        const finalAmount = Math.round(baseAmount * priceMultiplier);

        const messageText = `✅ **پلن تمدیدی ${plan.duration} (${userCount} کاربره) انتخاب شد**\n\nشناسه تمدید: **${renewalId}**\nمبلغ پایه: ${baseAmount.toLocaleString('fa-IR')} تومان\nهزینه ${extraUsers} کاربر اضافه (۵۰٪): ${(finalAmount - baseAmount).toLocaleString('fa-IR')} تومان\n\n**مبلغ قابل پرداخت:** **${finalAmount.toLocaleString('fa-IR')} تومان**`;

        const keyboard = [
            // callback: enter_coupon_code_[planType]_[requestedPlan]_[finalAmount]_[userCount]_[actionType (renew)]_[renewalId]
            [{ text: '🛍️ کد تخفیف دارم', callback_data: `enter_coupon_code_${planType}_${requestedPlan}_${finalAmount}_${userCount}_renew_${renewalId}` }],
            // callback: start_payment_[requestedPlan]_[finalAmount]_[userCount]_[couponCode (none)]_[renewalId]
            [{ text: '💳 رفتن به صفحه پرداخت (بدون کوپن)', callback_data: `start_payment_${requestedPlan}_${finalAmount}_${userCount}_none_${renewalId}` }],
            // بازگشت به منوی انتخاب کاربران
            [{ text: '⬅️ بازگشت به کاربران', callback_data: `plan_selected_renew_${planType}_${requestedPlan}_${renewalId}` }],
        ];

        return bot.editMessageText(messageText, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'Markdown'
        });
    }

    // --- مدیریت دریافت شناسه تمدید (متن ارسالی توسط کاربر) ---
    if (userState[chatId] && userState[chatId].step === 'awaiting_renewal_id') {
        const renewalId = data;
        const planType = 'unlimited'; // تمدید معمولا پلن های نامحدود را تمدید می کند
        
        // نمایش پلن های قابل تمدید (مانند منوی خرید نامحدود)
        return bot.sendMessage(chatId, `🔁 شناسه **${renewalId}** ثبت شد.\n\nلطفاً پلن تمدیدی مورد نظر خود را انتخاب کنید:`, {
            reply_markup: createPlansKeyboard(planType).inline_keyboard.map(row => 
                row.map(btn => ({ 
                    text: btn.text, 
                    // plan_selected_renew_[planType]_[amount]_[renewalId]
                    callback_data: btn.callback_data.replace('plan_selected_', `plan_selected_renew_`) + `_${renewalId}`
                }))
            ),
            parse_mode: 'Markdown'
        });
    }

    // --- مدیریت منوی برنامه‌ها ---
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
        // FIX: Change to callback_data to send the link as a message
        const keyboard = appList.map(a => ([{ text: a.text, callback_data: `send_app_link_${a.link}` }]));

        return bot.editMessageText(`✅ برنامه‌های پیشنهادی برای ${type}:`, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'Markdown'
        });
    }
    
    // NEW HANDLER: Send app link as a message
    if (data.startsWith('send_app_link_')) {
        const appLink = data.split('send_app_link_')[1];
        const messageText = `📥 لینک دانلود برنامه:\n\`${appLink}\``;
        
        // Send the link as a separate message
        return bot.sendMessage(chatId, messageText, { parse_mode: 'Markdown' });
    }

    // --- مدیریت کد تخفیف ---
    if (data.startsWith('enter_coupon_code_')) {
        // enter_coupon_code_[planType]_[requestedPlan (base price)]_[finalAmount (with multi-user)]_[userCount]_[actionType (buy/renew)]_[renewalId (optional)]
        const parts = data.split('_');
        const planType = parts[1];
        const requestedPlan = parts[2];
        const finalAmount = parts[3];
        const userCount = parts[4];
        const actionType = parts[5];
        const renewalId = parts[6] || '';
        
        // ذخیره وضعیت کاربر
        userState[chatId] = { step: 'awaiting_coupon', planType, requestedPlan, finalAmount, userCount, actionType, renewalId };

        return bot.editMessageText('🛍️ لطفاً کد تخفیف خود را ارسال کنید:', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 لغو و بازگشت', callback_data: actionType === 'renew' ? `renew_user_count_selected_${planType}_${requestedPlan}_${renewalId}_${userCount}` : `user_count_selected_${planType}_${requestedPlan}_${userCount}` }],
                ]
            }
        });
    }
    
    // --- مدیریت شروع پرداخت ---
    if (data.startsWith('start_payment_')) {
        // start_payment_[requestedPlan (base price)]_[finalAmount]_[userCount]_[couponCode]_[renewalId (optional)]
        const parts = data.split('_');
        const requestedPlan = parts[1]; // Base price for sheet lookup
        const finalAmount = parts[2]; // Final price to pay
        const userCount = parts[3]; // New: User Count
        const couponCode = parts[4];
        const renewalId = parts[5] || '';

        const url = `${APP_URL}/api/start-payment`;
        const postBody = {
            amount: finalAmount,
            description: `خرید/تمدید اشتراک ${requestedPlan} (${userCount} کاربره)`,
            chat_id: chatId.toString(),
            renewalIdentifier: renewalId,
            requestedPlan: requestedPlan,
            couponCode: couponCode.toLowerCase() === 'none' ? '' : couponCode, // FIXED TYPO
            userCount: userCount, // NEW FIELD
        };

        await bot.editMessageText('⏳ در حال اتصال به درگاه پرداخت...', {
            chat_id: chatId,
            message_id: messageId,
        });

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(postBody),
            });
            const result = await response.json();

            if (response.ok && result.authority) {
                const redirectUrl = `https://www.zarinpal.com/pg/StartPay/${result.authority}`;
                return bot.editMessageText('✅ لینک پرداخت ایجاد شد:\n\nلطفاً برای تکمیل خرید روی دکمه زیر کلیک کنید:', {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '💳 پرداخت با زرین‌پال', url: redirectUrl }],
                            [{ text: '🔙 بازگشت', callback_data: 'main_menu' }],
                        ]
                    }
                });
            } else {
                throw new Error(result.error || 'خطا در ایجاد لینک پرداخت.');
            }
        } catch (error) {
            console.error('Payment Start Error:', error);
            return bot.editMessageText(`❌ متاسفانه خطایی رخ داد: ${error.message}\n\nلطفاً دوباره تلاش کنید:`, {
                chat_id: chatId,
                message_id: messageId,
                ...mainMenu
            });
        }
    }

    // در نهایت، به جای هر دکمه دیگری که مدیریت نشده، یک آلارم کوچک نمایش داده شود
    bot.answerCallbackQuery(callbackQuery.id, { text: 'در حال پردازش...' });
});

// ------------------- مدیریت متن‌های ارسالی -------------------
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // --- مدیریت شناسه تمدید ---
    if (text && !text.startsWith('/')) {
        // اگر کاربر منتظر کد تخفیف باشد
        if (userState[chatId] && userState[chatId].step === 'awaiting_coupon') {
            const { planType, requestedPlan, finalAmount, userCount, actionType, renewalId } = userState[chatId];
            const couponCode = text.trim();
            delete userState[chatId]; // پاک کردن وضعیت

            // 1. بررسی کد تخفیف در بک‌اند
            const couponCheckUrl = `${APP_URL}/api/verify?action=check_coupon`;
            let discountPercentage = 0;
            let checkError = null;

            try {
                const response = await fetch(couponCheckUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        couponCode: couponCode, // Fixed typo
                        requestedAmount: requestedPlan // Base price for check
                    })
                });

                const result = await response.json();

                if (response.ok && result.discountPercentage) {
                    discountPercentage = Number(result.discountPercentage);
                } else {
                    checkError = result.error || 'کد تخفیف نامعتبر یا منقضی شده است.';
                }
            } catch (error) {
                checkError = 'خطای شبکه در بررسی کوپن.';
            }

            if (checkError) {
                // اگر کوپن نامعتبر بود، پیام خطا و بازگشت به منوی قبلی
                const backCallback = actionType === 'renew' ? `renew_user_count_selected_${planType}_${requestedPlan}_${renewalId}_${userCount}` : `user_count_selected_${planType}_${requestedPlan}_${userCount}`;
                
                return bot.sendMessage(chatId, `❌ **${checkError}**\n\nلطفاً دوباره تلاش کنید یا بدون کد تخفیف ادامه دهید:`, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🛍️ کد تخفیف دارم', callback_data: `enter_coupon_code_${planType}_${requestedPlan}_${finalAmount}_${userCount}_${actionType}_${renewalId}` }],
                            // start_payment_[requestedPlan]_[finalAmount]_[userCount]_[couponCode]_[renewalId (optional)]
                            [{ text: '💳 رفتن به صفحه پرداخت (بدون کوپن)', callback_data: `start_payment_${requestedPlan}_${finalAmount}_${userCount}_none_${renewalId}` }],
                            [{ text: '⬅️ بازگشت به کاربران', callback_data: backCallback }],
                        ]
                    }
                });
            }

            // 2. محاسبه قیمت نهایی با تخفیف
            const finalAmountAfterCoupon = Math.round(Number(finalAmount) * (1 - discountPercentage / 100));

            const messageText = `✅ **کد تخفیف ${discountPercentage}% اعمال شد**\n\n**مبلغ اولیه:** ${Number(finalAmount).toLocaleString('fa-IR')} تومان\n**میزان تخفیف:** ${Math.round(Number(finalAmount) * discountPercentage / 100).toLocaleString('fa-IR')} تومان\n\n**مبلغ نهایی قابل پرداخت:** **${finalAmountAfterCoupon.toLocaleString('fa-IR')} تومان**`;

            const keyboard = [
                // start_payment_[requestedPlan]_[finalAmountAfterCoupon]_[userCount]_[couponCode]_[renewalId (optional)]
                [{ text: '💳 رفتن به صفحه پرداخت', callback_data: `start_payment_${requestedPlan}_${finalAmountAfterCoupon}_${userCount}_${couponCode}_${renewalId}` }],
                [{ text: '🔙 لغو کد تخفیف و بازگشت', callback_data: actionType === 'renew' ? `renew_user_count_selected_${planType}_${requestedPlan}_${renewalId}_${userCount}` : `user_count_selected_${planType}_${requestedPlan}_${userCount}` }],
            ];

            return bot.sendMessage(chatId, messageText, {
                reply_markup: { inline_keyboard: keyboard },
                parse_mode: 'Markdown'
            });

        }
        
        // اگر کاربر در منوی تمدید است و شناسه را ارسال کرده
        if (text && userState[chatId] && userState[chatId].step === 'awaiting_renewal_id') {
            const renewalId = text.trim();
            const planType = 'unlimited'; 
            
            // نمایش پلن های قابل تمدید (مانند منوی خرید نامحدود)
            const keyboard = createPlansKeyboard(planType).inline_keyboard.map(row => 
                row.map(btn => ({ 
                    text: btn.text, 
                    // plan_selected_renew_[planType]_[amount]_[renewalId]
                    callback_data: btn.callback_data.replace('plan_selected_', `plan_selected_renew_`) + `_${renewalId}`
                }))
            );
            
            // پاک کردن وضعیت پس از دریافت شناسه و رفتن به مرحله بعد
            delete userState[chatId]; 
            
            return bot.sendMessage(chatId, `🔁 شناسه **${renewalId}** ثبت شد.\n\nلطفاً پلن تمدیدی مورد نظر خود را انتخاب کنید:`, {
                reply_markup: { inline_keyboard: keyboard },
                parse_mode: 'Markdown'
            });
        }
        
        // اگر کاربر در منوی تمدید است و هنوز شناسه را ارسال نکرده
        if (text && userState[chatId] && userState[chatId].step === 'awaiting_renewal_id') {
            const renewalId = text.trim();
            const planType = 'unlimited';
            
            // نمایش پلن های قابل تمدید (مانند منوی خرید نامحدود)
            const keyboard = createPlansKeyboard(planType).inline_keyboard.map(row => 
                row.map(btn => ({ 
                    text: btn.text, 
                    // plan_selected_renew_[planType]_[amount]_[renewalId]
                    callback_data: btn.callback_data.replace('plan_selected_', `plan_selected_renew_`) + `_${renewalId}`
                }))
            );

            // پاک کردن وضعیت پس از دریافت شناسه و رفتن به مرحله بعد
            delete userState[chatId];
            
            return bot.sendMessage(chatId, `🔁 شناسه **${renewalId}** ثبت شد.\n\nلطفاً پلن تمدیدی مورد نظر خود را انتخاب کنید:`, {
                reply_markup: { inline_keyboard: keyboard },
                parse_mode: 'Markdown'
            });
        }

        // اگر کاربر در منوی تمدید بود
        if (msg.reply_to_message && msg.reply_to_message.text && msg.reply_to_message.text.includes('لطفاً شناسه اشتراک خود را برای تمدید ارسال کنید:')) {
            const renewalId = text.trim();
            const planType = 'unlimited';
            
            // نمایش پلن های قابل تمدید (مانند منوی خرید نامحدود)
            const keyboard = createPlansKeyboard(planType).inline_keyboard.map(row => 
                row.map(btn => ({ 
                    text: btn.text, 
                    // plan_selected_renew_[planType]_[amount]_[renewalId]
                    callback_data: btn.callback_data.replace('plan_selected_', `plan_selected_renew_`) + `_${renewalId}`
                }))
            );
            
            return bot.sendMessage(chatId, `🔁 شناسه **${renewalId}** ثبت شد.\n\nلطفاً پلن تمدیدی مورد نظر خود را انتخاب کنید:`, {
                reply_markup: { inline_keyboard: keyboard },
                parse_mode: 'Markdown'
            });
        }
        
        // اگر متن ارسالی در وضعیت خاصی نبود، آن را نادیده بگیر
        if (!msg.reply_to_message) {
            return bot.sendMessage(chatId, 'لطفاً از طریق دکمه‌های منو اقدام به خرید نمایید.', mainMenu);
        }
    }
});

// مدیریت متن برای تمدید (به دلیل باگ در نسخه قبلی که متن دریافتی را به صورت callback_data ارسال می‌کرد)
bot.onText(/(.*)/, (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text && !text.startsWith('/') && !userState[chatId]) {
        // فرض بر این است که اگر کاربر در پاسخ به پیام "لطفاً شناسه اشتراک خود را برای تمدید ارسال کنید:" متنی ارسال کرده، قصد تمدید دارد.
        // این بخش نیاز به بررسی دقیق‌تر دارد که آیا متن ارسالی صرفاً یک شناسه است یا خیر.
        
        // اگر در منوی تمدید کلیک شده باشد (طبق منطق menu_renew) و انتظار شناسه باشد:
        if (msg.reply_to_message && msg.reply_to_message.text && msg.reply_to_message.text.includes('لطفاً شناسه اشتراک خود را برای تمدید ارسال کنید:')) {
            const renewalId = text.trim();
            const planType = 'unlimited'; 
            
            // نمایش پلن های قابل تمدید
            const keyboard = createPlansKeyboard(planType).inline_keyboard.map(row => 
                row.map(btn => ({ 
                    text: btn.text, 
                    callback_data: btn.callback_data.replace('plan_selected_', `plan_selected_renew_`) + `_${renewalId}`
                }))
            );
            
            return bot.sendMessage(chatId, `🔁 شناسه **${renewalId}** ثبت شد.\n\nلطفاً پلن تمدیدی مورد نظر خود را انتخاب کنید:`, {
                reply_markup: { inline_keyboard: keyboard },
                parse_mode: 'Markdown'
            });
        }
    }
});