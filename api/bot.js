const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const APP_URL = process.env.APP_URL;
const bot = new TelegramBot(TOKEN);

// --- داده های ربات ---
const plans = {
    unlimited: [
        { text: '💎 ۱ ماهه - ۱۲۰,۰۰۰ تومان', amount: 120000 },
        { text: '🚀 ۲ ماهه - ۲۲۰,۰۰۰ تومان', amount: 220000 },
        { text: '🌟 ۳ ماهه - ۳۴۰,۰۰۰ تومان', amount: 340000 },
        { text: '🔥 ۶ ماهه - ۶۰۰,۰۰۰ تومان', amount: 600000 },
        { text: '🛡️ ۱ ساله - ۱,۰۰۰,۰۰۰ تومان', amount: 1000000 },
        { text: '👑 ۲ ساله - ۲,۰۰۰,۰۰۰ تومان', amount: 2000000 },
    ],
    national: [ // Placeholder plans
        { text: '🇮🇷 ۱ ماهه ملی - ۱۲۰,۰۰۰ تومان', amount: 120000 },
        { text: '🇮🇷 ۳ ماهه ملی - ۳۴۰,۰۰۰ تومان', amount: 340000 },
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
        return bot.sendMessage(chatId, '🚀 به ربات فروش اشتراک Ay Technic خوش آمدید!\n\nلطفاً از منوی زیر سرویس مورد نظر خود را انتخاب کنید:', mainKeyboard);
    }

    // --- مدیریت فرآیند کوپن ---
    if (userStates[chatId] && userStates[chatId].step === 'awaiting_coupon_code') {
        userStates[chatId].coupenCode = text.trim();
        userStates[chatId].step = 'awaiting_confirmation'; // تغییر وضعیت به تأیید نهایی
        
        const state = userStates[chatId];
        const planType = state.planType;
        const requestedPlan = state.requestedPlan;
        const basePlan = plans[planType].find(p => p.amount.toString() === requestedPlan);
        const originalAmount = basePlan.amount;

        try {
            // تماس با verify.js برای اعتبارسنجی و محاسبه قیمت نهایی
            const couponCheckResponse = await fetch(`${APP_URL}/api/verify?action=check_coupon&code=${state.coupenCode}&amount=${originalAmount}`);
            const couponData = await couponCheckResponse.json();

            if (couponData.error) {
                // اگر کوپن نامعتبر بود، به کاربر اطلاع بده و به مرحله قبل (انتخاب کوپن) برگرد
                userStates[chatId].coupenCode = null; // کوپن را پاک کن
                userStates[chatId].step = 'awaiting_confirmation'; // برای این که به مرحله خرید برگردد
                await bot.sendMessage(chatId, `❌ ${couponData.error}`);
                // ادامه برای نمایش دکمه "بدون کوپن" یا "کوپن جدید"
            } else {
                // کوپن معتبر است، قیمت نهایی را ذخیره کن
                state.finalAmount = couponData.finalAmount;
                state.discountAmount = couponData.discountAmount;
                
                let message = `✅ کد تخفیف **${state.coupenCode}** اعمال شد.
مبلغ اصلی: ${originalAmount.toLocaleString('fa-IR')} تومان
مقدار تخفیف: **${state.discountAmount.toLocaleString('fa-IR')} تومان**
مبلغ قابل پرداخت: **${state.finalAmount.toLocaleString('fa-IR')} تومان**`;

                const keyboard = [
                    [{ text: '💳 رفتن به صفحه پرداخت', callback_data: `start_payment_${requestedPlan}_${state.finalAmount}_${state.coupenCode}` }],
                    [{ text: '❌ انصراف از کوپن و خرید', callback_data: `start_payment_${requestedPlan}_${originalAmount}_none` }],
                    [{ text: '⬅️ بازگشت به پلن‌ها', callback_data: `menu_buy_${planType}` }],
                ];

                return bot.sendMessage(chatId, message, {
                    reply_markup: { inline_keyboard: keyboard },
                    parse_mode: 'Markdown'
                });
            }

        } catch (error) {
            console.error('Coupon API Check Error:', error.message);
            userStates[chatId].coupenCode = null;
            await bot.sendMessage(chatId, '⚠️ خطایی در بررسی کد تخفیف رخ داد. لطفاً دوباره تلاش کنید.');
        }
    }
    
    // مدیریت فرآیند تمدید (اگر پیام متنی یک آی‌دی تمدید بود)
    if (userStates[chatId] && userStates[chatId].step === 'awaiting_renewal_id') {
        userStates[chatId].renewalIdentifier = text.trim();
        userStates[chatId].step = 'awaiting_plan_type';
        // ادامه فرآیند...
        // ...
    }

    // اگر پیام متنی یک کوپن نبود، به منوی اصلی برگرد
    if (userStates[chatId] && userStates[chatId].step === 'awaiting_coupon_code') {
        const mainKeyboard = await getMainMenuKeyboard(chatId);
        await bot.sendMessage(chatId, '❌ لطفاً فقط کد تخفیف خود را وارد کنید یا /start را بزنید.', mainKeyboard);
        delete userStates[chatId]; // پاک کردن حالت
    }
}

// --- مدیریت دکمه‌های اینلاین ---
async function handleCallbackQuery(callbackQuery) {
    const message = callbackQuery.message;
    const chatId = message.chat.id;
    const data = callbackQuery.data;
    const messageId = message.message_id;

    // --- مدیریت منوی اصلی ---
    if (data === 'menu_main') {
        const mainKeyboard = await getMainMenuKeyboard(chatId);
        return bot.editMessageText('🚀 لطفاً سرویس مورد نظر خود را انتخاب کنید:', {
            chat_id: chatId,
            message_id: messageId,
            ...mainKeyboard
        });
    }

    // --- قابلیت جدید: نمایش سرویس‌های من ---
    if (data === 'menu_my_services') {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'در حال جستجوی تاریخچه خریدهای شما...' });
        try {
            const historyResponse = await fetch(`${APP_URL}/api/verify?action=history&chat_id=${chatId}`);
            const history = await historyResponse.json();

            let historyMessage = '';

            if (history && history.length > 0) {
                historyMessage = '📜 **سوابق خرید شما:**\n\n';
                history.forEach((p, index) => {
                    // تاریخ انقضا فعلاً به صورت نامشخص در نظر گرفته می‌شود تا زمانی که در شیت اضافه کنید
                    const expiryStatus = p.expiryDate && new Date(p.expiryDate) > new Date() ? '✅ فعال' : '❌ منقضی شده';
                    historyMessage += `**-- خرید ${index + 1} --**
**پلن:** ${p.plan}
**تاریخ خرید:** ${new Date(p.purchaseDate).toLocaleDateString('fa-IR')}
**لینک اشتراک:** \`${p.link}\`
**وضعیت:** ${expiryStatus}
**پیگیری:** ${p.trackingId}\n\n`;
                });
            } else {
                historyMessage = '❌ شما تاکنون سرویسی خریداری نکرده‌اید.';
            }

            return bot.editMessageText(historyMessage, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: backToMainMenuBtn },
                parse_mode: 'Markdown'
            });

        } catch (error) {
            console.error('My Services Error:', error.message);
            return bot.editMessageText('⚠️ خطایی در دریافت اطلاعات تاریخچه رخ داد.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: backToMainMenuBtn }
            });
        }
    }


    // --- مدیریت منوهای خرید ---
    if (data.startsWith('menu_buy_')) {
        const type = data.split('_')[2];
        const planList = plans[type];
        
        // دکمه‌های پلن‌ها
        const planButtons = planList.map(p => ([{ text: p.text, callback_data: `select_plan_${type}_${p.amount}` }]));

        return bot.editMessageText(`لطفاً یکی از پلن‌های ${type === 'unlimited' ? 'نامحدود' : 'اینترنت ملی'} را انتخاب کنید:`, {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [...planButtons, ...backToMainMenuBtn] }
        });
    }

    // --- انتخاب پلن و اضافه کردن کوپن ---
    if (data.startsWith('select_plan_')) {
        const parts = data.split('_');
        const planType = parts[2];
        const requestedPlan = parts[3];
        const basePlan = plans[planType].find(p => p.amount.toString() === requestedPlan);
        const originalAmount = basePlan.amount;

        // ذخیره وضعیت کاربر
        userStates[chatId] = {
            step: 'awaiting_confirmation',
            planType: planType,
            requestedPlan: requestedPlan,
            originalAmount: originalAmount,
        };
        
        await bot.answerCallbackQuery(callbackQuery.id);

        // نمایش گزینه‌های خرید (با یا بدون کوپن)
        const messageText = `پلن انتخابی شما: **${basePlan.text}**

قیمت قابل پرداخت: **${originalAmount.toLocaleString('fa-IR')} تومان**`;
        
        const keyboard = [
            // گزینه کوپن
            [{ text: '🛍️ کد تخفیف دارم', callback_data: `enter_coupon_code_${planType}_${requestedPlan}` }],
            // گزینه پرداخت بدون کوپن
            [{ text: '💳 رفتن به صفحه پرداخت (بدون کوپن)', callback_data: `start_payment_${requestedPlan}_${originalAmount}_none` }],
            [{ text: '⬅️ بازگشت به پلن‌ها', callback_data: `menu_buy_${planType}` }],
        ];

        return bot.editMessageText(messageText, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'Markdown'
        });
    }
    
    // --- درخواست کد کوپن ---
    if (data.startsWith('enter_coupon_code_')) {
        const parts = data.split('_');
        const planType = parts[3];
        const requestedPlan = parts[4];

        // به‌روزرسانی وضعیت کاربر برای دریافت پیام متنی کوپن
        userStates[chatId] = {
            step: 'awaiting_coupon_code',
            planType: planType,
            requestedPlan: requestedPlan,
        };
        
        await bot.answerCallbackQuery(callbackQuery.id);

        // ارسال درخواست وارد کردن کوپن
        return bot.sendMessage(chatId, 'لطفاً کد تخفیف خود را در قسمت پیام متنی وارد کنید:');
    }

    // --- شروع پرداخت نهایی (از منوی خرید) ---
    if (data.startsWith('start_payment_')) {
        const parts = data.split('_');
        const requestedPlan = parts[2];
        const finalAmount = parts[3]; // قیمت نهایی پس از اعمال تخفیف
        const coupenCode = parts[4] === 'none' ? '' : parts[4];
        
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'در حال ساخت لینک پرداخت...' });
        
        // حذف حالت کاربر پس از شروع پرداخت
        delete userStates[chatId]; 
        
        const amountRial = Number(finalAmount) * 10; // تبدیل به ریال
        
        const payload = {
            amount: amountRial,
            description: `خرید پلن ${requestedPlan} با کد کوپن ${coupenCode || 'بدون کوپن'}`,
            chat_id: chatId,
            requestedPlan: requestedPlan,
            coupenCode: coupenCode, // ارسال کد کوپن به start-payment.js
            // سایر اطلاعات مانند name, email, phone در ربات معمولاً گرفته نمی‌شود، اما اگر می‌گیرید، اینجا اضافه کنید.
        };
        
        try {
            const response = await fetch(`${APP_URL}/api/start-payment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const responseData = await response.json();

            if (response.ok && responseData.authority) {
                const paymentLink = `https://www.zarinpal.com/pg/StartPay/${responseData.authority}`;
                return bot.sendMessage(chatId, `🔗 لینک پرداخت با مبلغ **${Number(finalAmount).toLocaleString('fa-IR')} تومان** آماده شد. لطفاً پرداخت را از طریق دکمه زیر تکمیل کنید:`, {
                    reply_markup: { inline_keyboard: [[{ text: '💳 پرداخت آنلاین', url: paymentLink }]] },
                    parse_mode: 'Markdown'
                });
            } else {
                throw new Error(responseData.details || 'سرور درگاه پرداخت پاسخ نداد.');
            }
        } catch (error) {
            console.error('Payment Start Error:', error.message);
            return bot.sendMessage(chatId, '⚠️ خطایی در شروع فرآیند پرداخت رخ داد. لطفاً با پشتیبانی تماس بگیرید.');
        }
    }
    
    // ... [بقیه کدها برای تمدید، برنامه‌ها و غیره دست نخورده باقی می‌ماند] ...

    // مدیریت منوی تمدید
    if (data === 'menu_renew') {
        userStates[chatId] = { step: 'awaiting_renewal_id' };
        await bot.answerCallbackQuery(callbackQuery.id);
        return bot.editMessageText('لطفاً ایمیل، شماره تلفن یا شماره پیگیری خرید قبلی خود را برای تمدید وارد کنید:', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: backToMainMenuBtn }
        });
    }

    // مدیریت انتخاب نوع تمدید
    if(data.startsWith('renew_type_')) {
        const type = data.split('_')[2];
        const state = userStates[chatId];
        if(!state || state.step !== 'awaiting_plan_type') return;

        const planList = plans[type];
        const keyboard = planList.map(p => ([{ text: p.text, callback_data: `renew_plan_${p.amount}` }]));
        return bot.editMessageText(`تمدید برای اشتراک ${type === 'unlimited' ? 'نامحدود' : 'ملی'}. لطفاً پلن جدید را انتخاب کنید:`, {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [...keyboard, ...backToMainMenuBtn] }
        });
    }
    
    // مدیریت انتخاب پلن تمدید و شروع پرداخت
    if (data.startsWith('renew_plan_')) {
        const requestedPlan = data.split('_')[2];
        const state = userStates[chatId];
        
        if(!state || state.step !== 'awaiting_plan_type') return;

        // ... [منطق محاسبه قیمت تمدید] ...
        const plan = plans.unlimited.find(p => p.amount.toString() === requestedPlan) || plans.national.find(p => p.amount.toString() === requestedPlan);
        const finalAmount = plan ? plan.amount : 0; // قیمت پایه
        const originalAmount = finalAmount;
        
        // ... اینجا منطق اعمال کوپن برای تمدید نیز می‌تواند تکرار شود ...
        
        await bot.answerCallbackQuery(callbackQuery.id);
        
        // نمایش گزینه‌های تمدید (با یا بدون کوپن)
        const messageText = `پلن انتخابی شما برای تمدید: **${plan.text}**

قیمت قابل پرداخت: **${originalAmount.toLocaleString('fa-IR')} تومان**`;
        
        const keyboard = [
            // گزینه کوپن برای تمدید
            [{ text: '🛍️ کد تخفیف دارم', callback_data: `enter_coupon_code_${plan.type || 'unlimited'}_${requestedPlan}_renew` }],
            // گزینه پرداخت بدون کوپن
            [{ text: '💳 رفتن به صفحه پرداخت (بدون کوپن)', callback_data: `start_payment_${requestedPlan}_${originalAmount}_none` }],
            [{ text: '⬅️ بازگشت به پلن‌ها', callback_data: `menu_buy_${plan.type || 'unlimited'}` }],
        ];

        return bot.editMessageText(messageText, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: keyboard },
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
        const keyboard = appList.map(a => ([{ text: a.text, url: a.url }]));

        return bot.editMessageText(`✅ برنامه‌های پیشنهادی برای ${type}:`, {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [...keyboard, ...backToAppsMenuBtn] }
        });
    }
}