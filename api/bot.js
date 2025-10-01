const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const APP_URL = process.env.APP_URL;
const bot = new TelegramBot(TOKEN);

// --- داده های ربات ---
const plans = {
    unlimited: [
        { text: '💎 ۱ ماهه - ۱۲۰,۰۰۰ تومان', amount: 12000 },
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

// --- منوهای دکمه‌ای ---
const mainMenu = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '💎 اشتراک نامحدود | ثابت 💎', callback_data: 'menu_buy_unlimited' }],
            [{ text: '🇮🇷 اشتراک اینترنت ملی 🇮🇷', callback_data: 'menu_buy_national' }],
            [{ text: '🔄 تمدید اشتراک قبلی', callback_data: 'menu_renew' }],
            [{ text: '📱 برنامه های اتصال', callback_data: 'menu_apps' }],
        ]
    }
};

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

// --- متغیر برای مدیریت وضعیت تمدید ---
let userStates = {};

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
        return bot.sendMessage(chatId, '🚀 به ربات فروش اشتراک Ay Technic خوش آمدید!\n\nلطفاً از منوی زیر سرویس مورد نظر خود را انتخاب کنید:', mainMenu);
    }
    
    // مدیریت فرآیند تمدید
    if (userStates[chatId] === 'awaiting_renewal_id') {
        userStates[chatId] = { step: 'awaiting_plan_type', identifier: text };
        const renewalTypeMenu = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💎 نامحدود', callback_data: 'renew_type_unlimited' }, { text: '🇮🇷 ملی', callback_data: 'renew_type_national' }],
                    ...backToMainMenuBtn
                ]
            }
        };
        return bot.sendMessage(chatId, '✅ مشخصات دریافت شد.\n\nحالا لطفاً نوع اشتراکی که می‌خواهید تمدید کنید را انتخاب نمایید:', renewalTypeMenu);
    }
}

// --- مدیریت کلیک روی دکمه‌ها ---
async function handleCallbackQuery(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;

    await bot.answerCallbackQuery(callbackQuery.id);

    // --- مدیریت منوها ---
    if (data === 'menu_main') {
        return bot.editMessageText('لطفاً از منوی زیر سرویس مورد نظر خود را انتخاب کنید:', { chat_id: chatId, message_id: messageId, ...mainMenu });
    }
    if (data.startsWith('menu_buy_')) {
        const type = data.split('_')[2];
        const planList = plans[type];
        const keyboard = planList.map(p => ([{ text: p.text, callback_data: `buy_${p.amount}` }]));
        return bot.editMessageText(`🛍️ لطفاً پلن اشتراک ${type === 'unlimited' ? 'نامحدود' : 'ملی'} مورد نظر خود را انتخاب کنید:`, {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [...keyboard, ...backToMainMenuBtn] }
        });
    }
    if (data === 'menu_renew') {
        userStates[chatId] = 'awaiting_renewal_id';
        return bot.editMessageText('🔄 برای تمدید، لطفاً یکی از مشخصات اشتراک قبلی خود را ارسال کنید (مانند لینک اشتراک، ایمیل، شماره تماس و...):', {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: backToMainMenuBtn }
        });
    }
    if (data === 'menu_apps') {
        return bot.editMessageText('📱 لطفاً سیستم عامل خود را برای دریافت برنامه‌های اتصال انتخاب کنید:', { chat_id: chatId, message_id: messageId, ...appsMenu });
    }
    if (data.startsWith('apps_')) {
        const os = data.split('_')[1];
        const appList = apps[os];
        const keyboard = appList.map(app => ([{ text: `⬇️ ${app.text}`, url: app.url }]));
        return bot.editMessageText(`📲 برنامه‌های پیشنهادی برای ${os.charAt(0).toUpperCase() + os.slice(1)}:`, {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [...keyboard, ...backToAppsMenuBtn] }
        });
    }

    // --- مدیریت خرید و پرداخت ---
    if (data.startsWith('buy_') || data.startsWith('renew_plan_')) {
        let amount, planType, renewalIdentifier = null;
        
        if (data.startsWith('buy_')) {
            amount = data.split('_')[1];
        } else { // Renew plan
            const parts = data.split('_');
            amount = parts[2];
            planType = parts[1];
            renewalIdentifier = userStates[chatId]?.identifier;
            if (!renewalIdentifier) return bot.sendMessage(chatId, 'خطا: اطلاعات تمدید یافت نشد. لطفاً از ابتدا شروع کنید.');
        }

        const allPlans = [...plans.unlimited, ...plans.national];
        const planDetails = allPlans.find(p => p.amount == amount);
        
        if (planDetails) {
            await bot.sendMessage(chatId, `⏳ در حال ساخت لینک پرداخت برای "${planDetails.text}"...`);
            
            const user = callbackQuery.from;
            const payload = {
                amount: planDetails.amount,
                description: planDetails.text,
                chat_id: chatId,
                name: user.first_name + (user.last_name ? ' ' + user.last_name : ''),
                email: user.id.toString(), // Storing Telegram ID in email field
                phone: user.username || 'N/A' // Storing Telegram username in phone field
            };

            if(renewalIdentifier) {
                payload.renewalIdentifier = renewalIdentifier;
                payload.requestedPlan = planDetails.text;
            }

            const response = await fetch(`${APP_URL}/api/start-payment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const responseData = await response.json();

            if (response.ok && responseData.authority) {
                const paymentLink = `https://www.zarinpal.com/pg/StartPay/${responseData.authority}`;
                return bot.sendMessage(chatId, '🔗 لینک پرداخت شما آماده شد. لطفاً پرداخت را از طریق دکمه زیر تکمیل کنید:', {
                    reply_markup: { inline_keyboard: [[{ text: '💳 پرداخت آنلاین', url: paymentLink }]] }
                });
            } else {
                throw new Error(responseData.details || 'سرور درگاه پرداخت پاسخ نداد.');
            }
        }
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
}
