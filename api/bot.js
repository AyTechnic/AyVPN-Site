const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// --- متغیرهای شما ---
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const APP_URL = process.env.APP_URL;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID; 
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const ADMIN_CHAT_ID = '5976170456'; 

// **تغییر ۱: حذف { polling: true }** const bot = new TelegramBot(TOKEN); 

// --- توابع مدیریت خطای شبکه (برای حل مشکل EPIPE و TLS) ---
// این توابع تلاش می‌کنند پیام بفرستند اما اگر شکست خورد، اجازه می‌دهند اجرای کد ادامه یابد.
const safeSendMessage = (chatId, text, options = {}) => {
    // Note: In Vercel, this often fails with EPIPE. It's safe, but not always successful.
    // For critical first messages like /start, we use direct fetch in module.exports.
    return bot.sendMessage(chatId, text, options).catch(err => {
        console.error(`Safe Send Error to ${chatId}:`, err.message);
    });
};

const safeEditMessageText = (text, options) => {
    return bot.editMessageText(text, options).catch(err => {
        console.error(`Safe Edit Error (msgID: ${options.message_id}):`, err.message);
    });
};

const safeAnswerCallbackQuery = (queryId, options = {}) => {
    return bot.answerCallbackQuery(queryId, options).catch(err => {
        console.error(`Safe Answer CQ Error:`, err.message);
    });
};

// NEW: نام شیت کوپن
const COUPEN_SHEET_TITLE = 'Coupen';

// NEW: مدیریت وضعیت کاربر برای ورودی‌های چند مرحله‌ای (برای تمدید و پیگیری) و ذخیره تعداد کاربر
const userStates = {};

// --- توابع کمکی Google Sheet (تکرار از verify.js) ---
async function getDoc() {
    // احراز هویت سرویس گوگل
    const serviceAccountAuth = new JWT({
        email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
        // Replace all escaped newline characters with actual newline characters
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
                row: coupenRow 
            };
        }
        
        return null; 
    } catch (error) {
        console.error('Error fetching coupen details:', error.message);
        return null; 
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
            // تخفیف مبلغی ثابت 
            discountAmount = coupenDetails.price;
        }
        
        finalAmount = originalAmount - discountAmount;
        
        // اطمینان از اینکه قیمت نهایی کمتر از صفر نشود (حداقل ۱۰۰۰ تومان)
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
    ],
};

// --- منوهای Inline ---
const mainMenu = {
    inline_keyboard: [
        [{ text: '🛒 خرید اشتراک جدید', callback_data: 'menu_purchase' }],
        [{ text: '🔄 تمدید اشتراک', callback_data: 'state_renew' }],
        [{ text: '🔍 پیگیری سفارش', callback_data: 'state_track' }],
        [{ text: '📱 برنامه‌های پیشنهادی', callback_data: 'menu_apps' }]
    ]
};

const appsMenu = {
    inline_keyboard: [
        [{ text: '🤖 اندروید', callback_data: 'apps_android' }, { text: '🍎 iOS', callback_data: 'apps_ios' }],
        [{ text: '🖥️ ویندوز', callback_data: 'apps_windows' }, { text: '💻 مک', callback_data: 'apps_mac' }],
        [{ text: '⬅️ بازگشت به منو اصلی', callback_data: 'menu_main' }]
    ]
};

// **تغییر ۲: حذف bot.onText(/\/start/, ...)**

// --- ۲. مدیریت متن‌های ارسالی کاربر ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // اگر کاربر دستور /start داد یا در حال انتظار برای ورودی خاصی نباشد، کاری نمی‌کنیم
    // زیرا /start در تابع module.exports مدیریت می‌شود.
    if (text === '/start' || !userStates[chatId]) return;

    const state = userStates[chatId];

    // --- مدیریت مرحله ۳: وارد کردن کد پیگیری ---
    if (state.step === 'awaiting_tracking_id') {
        const trackingId = text.trim();
        
        // نوتیفیکیشن پیگیری
        safeSendMessage(chatId, `🔍 در حال پیگیری سفارش شما با کد: **${trackingId}** ...\n\nلطفاً صبر کنید.`, { parse_mode: 'Markdown' });

        try {
            const url = `${APP_URL}/api/track?trackingId=${trackingId}`;
            const response = await fetch(url);

            if (response.status === 404) {
                safeSendMessage(chatId, '❌ سفارشی با این شناسه یافت نشد. لطفاً کد را با دقت بررسی و دوباره وارد کنید.');
                return;
            }

            if (!response.ok) {
                throw new Error(`Server returned status ${response.status}`);
            }

            const results = await response.json();
            
            let html = '✅ **سفارشات یافت شده:**\n\n';
            results.forEach((item, index) => {
                const planName = item.plan.endsWith('D') ? `${parseInt(item.plan)} روزه` : (item.plan === 'Renew' ? 'تمدید' : item.plan);
                html += `**شماره ${index + 1}:**\n`
                html += `🔸 **پلن:** ${planName}\n`
                html += `🔸 **تاریخ خرید:** ${item.date}\n`
                html += `🔸 **لینک اشتراک:** [لینک دسترسی](${item.link})\n\n`
            });

            safeSendMessage(chatId, html, {
                reply_markup: mainMenu,
                parse_mode: 'Markdown'
            });

        } catch (error) {
            console.error('Tracking fetch error:', error.message);
            safeSendMessage(chatId, '❌ خطای سرور در پیگیری سفارش. لطفاً بعداً تلاش کنید یا به پشتیبانی پیام دهید.');
        } finally {
            // حذف وضعیت کاربر پس از اتمام پیگیری
            delete userStates[chatId];
        }

    }

    // --- مدیریت مرحله ۳: وارد کردن کد تمدید (ایمیل/نام کاربری) ---
    if (state.step === 'awaiting_renewal_id') {
        const renewalIdentifier = text.trim();
        state.renewalIdentifier = renewalIdentifier;
        state.step = 'awaiting_coupen_code'; // به مرحله وارد کردن کوپن بروید
        
        // پیام بعدی
        safeSendMessage(chatId, `لطفاً کد تخفیف (کوپن) خود را وارد کنید.\n\n اگر کد تخفیف ندارید، دستور /skip را ارسال کنید.`, {
             reply_markup: {
                keyboard: [
                    [{ text: '/skip' }]
                ],
                resize_keyboard: true,
                one_time_keyboard: true
            }
        });
    }

    // --- مدیریت مرحله ۴: وارد کردن کد کوپن ---
    if (state.step === 'awaiting_coupen_code') {
        let coupenCode = text.trim();
        
        if (coupenCode === '/skip') {
            coupenCode = ''; // اگر اسکیپ شد، کوپن خالی است
        }

        let coupenDetails = null;
        let coupenError = null;

        if (coupenCode) {
            // جستجو و اعتبار سنجی کوپن
            const result = await getCoupenDetails(coupenCode);
            if (result && result.error) {
                coupenError = result.error;
            } else if (result) {
                coupenDetails = result;
            }
        }
        
        if (coupenError) {
            // کوپن نامعتبر یا خطا
            safeSendMessage(chatId, `❌ **خطا:** ${coupenError}\n\nلطفاً کد تخفیف معتبر دیگری وارد کنید یا دستور /skip را برای رد شدن از این مرحله ارسال کنید.`, { parse_mode: 'Markdown' });
            // وضعیت در awaiting_coupen_code باقی می‌ماند
            return;
        }

        // کوپن معتبر یا اسکیپ شد.
        state.coupenCode = coupenCode;
        state.coupenDetails = coupenDetails;
        state.step = 'awaiting_name'; // به مرحله وارد کردن نام بروید
        
        // حذف کیبورد skip
        
        safeSendMessage(chatId, `✅ کد تخفیف **${coupenCode ? 'اعمال شد' : 'رد شد'}**.\n\nلطفاً نام و نام خانوادگی خود را وارد کنید:`, {
            parse_mode: 'Markdown',
            reply_markup: { remove_keyboard: true }
        });
    }

    // --- مدیریت مرحله ۵: وارد کردن نام ---
    if (state.step === 'awaiting_name') {
        state.name = text.trim();
        state.step = 'awaiting_email';
        safeSendMessage(chatId, 'لطفاً ایمیل خود را وارد کنید:');
    }

    // --- مدیریت مرحله ۶: وارد کردن ایمیل ---
    if (state.step === 'awaiting_email') {
        state.email = text.trim();
        state.step = 'awaiting_phone';
        safeSendMessage(chatId, 'لطفاً شماره تماس (اختیاری) خود را وارد کنید:');
    }
    
    // --- مدیریت مرحله ۷: وارد کردن شماره تماس ---
    if (state.step === 'awaiting_phone') {
        state.phone = text.trim();
        state.step = 'final_confirmation';
        
        const plan = plansData.find(p => p.requestedPlan === state.requestedPlan);
        
        // محاسبه قیمت نهایی
        const originalAmount = calculateMultiUserPrice(plan.baseAmount, state.users);
        const { finalAmount, discountAmount } = applyCoupenDiscount(originalAmount, state.coupenDetails);
        
        state.amount = finalAmount; // ذخیره قیمت نهایی

        let confirmationMessage = `**✅ تأیید نهایی سفارش شما:**\n\n`;
        confirmationMessage += `🔹 **نوع درخواست:** ${state.type === 'purchase' ? 'خرید اشتراک جدید' : 'تمدید اشتراک'}\n`;
        if (state.type === 'renew') {
            confirmationMessage += `🔹 **شناسه تمدید:** ${state.renewalIdentifier}\n`;
        }
        confirmationMessage += `🔹 **پلن انتخابی:** ${plan.icon} ${plan.duration}\n`;
        confirmationMessage += `🔹 **تعداد کاربران:** ${state.users}\n`;
        confirmationMessage += `🔹 **نام:** ${state.name}\n`;
        confirmationMessage += `🔹 **ایمیل:** ${state.email}\n`;
        confirmationMessage += `🔹 **شماره تماس:** ${state.phone || 'وارد نشده'}\n\n`;
        
        confirmationMessage += `--- **جزئیات مالی** ---\n`;
        confirmationMessage += `🔸 **قیمت پایه (${state.users} کاربر):** ${formatAmount(originalAmount)} تومان\n`;
        if (state.coupenCode) {
            confirmationMessage += `🎁 **کد تخفیف (${state.coupenCode}):** ${formatAmount(discountAmount)} تومان\n`;
        }
        confirmationMessage += `💰 **مبلغ نهایی قابل پرداخت:** ${formatAmount(finalAmount)} تومان\n\n`;
        
        confirmationMessage += `آیا اطلاعات فوق را تأیید می‌کنید؟`;

        safeSendMessage(chatId, confirmationMessage, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ تأیید و شروع پرداخت', callback_data: 'final_confirm_yes' }],
                    [{ text: '❌ لغو سفارش', callback_data: 'menu_main' }]
                ]
            },
            parse_mode: 'Markdown'
        });
    }
});


// --- ۳. مدیریت دکمه‌ها (Callback Queries) ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    
    // **تغییر ۳: استفاده از تابع ایمن**
    safeAnswerCallbackQuery(query.id); 

    // --- مدیریت منو اصلی (بازگشت به منو اصلی) ---
    if (data === 'menu_main') {
        delete userStates[chatId];
        const welcomeMessage = `سلام شــــامـــــــــای عزیز! به ربات خرید و تمدید اشتراک **Ay Technic** خوش آمدید.\n\nلطفاً برای ادامه یکی از گزینه‌های زیر را انتخاب کنید:`;
        return safeEditMessageText(welcomeMessage, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: mainMenu,
            parse_mode: 'Markdown'
        });
    }

    // --- ۱. مدیریت شروع فرآیند خرید/تمدید ---
    // شروع خرید جدید
    if (data === 'menu_purchase') {
        userStates[chatId] = { step: 'awaiting_plan_selection', type: 'purchase', users: 1 };
        
        const purchaseMenu = {
            inline_keyboard: plansData.map(p => ([{ text: `${p.icon} ${p.duration} - ${formatAmount(p.baseAmount)} تومان`, callback_data: `plan_select_${p.requestedPlan}` }])),
            
        };
        purchaseMenu.inline_keyboard.push([{ text: '⬅️ بازگشت به منو اصلی', callback_data: 'menu_main' }]);

        return safeEditMessageText('🛒 پلن مورد نظر خود را برای خرید جدید انتخاب کنید:', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: purchaseMenu
        });
    }

    // شروع تمدید
    if (data === 'state_renew') {
        userStates[chatId] = { step: 'awaiting_renewal_id', type: 'renew' };
        
        // **تغییر ۴: استفاده از تابع ایمن**
        return safeEditMessageText('🔄 لطفاً **ایمیل یا نام کاربری** مرتبط با اشتراک قبلی خود را برای تمدید وارد کنید.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ بازگشت به منو اصلی', callback_data: 'menu_main' }]] }
        });
    }
    
    // شروع پیگیری
    if (data === 'state_track') {
        userStates[chatId] = { step: 'awaiting_tracking_id', type: 'track' };
        
        // **تغییر ۵: استفاده از تابع ایمن**
        safeSendMessage(chatId, '🔍 لطفاً **کد پیگیری (Tracking ID)** یا **ایمیل/نام کاربری** که هنگام خرید وارد کرده‌اید را وارد کنید.');
        
        // **تغییر ۶: استفاده از تابع ایمن**
        return safeEditMessageText('🔍 لطفاً **کد پیگیری (Tracking ID)** یا **ایمیل/نام کاربری** که هنگام خرید وارد کرده‌اید را وارد کنید.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '⬅️ بازگشت به منو اصلی', callback_data: 'menu_main' }]] }
        });
    }

    // --- ۲. مدیریت انتخاب پلن (برای خرید و تمدید) ---
    if (data.startsWith('plan_select_') || data.startsWith('renew_plan_')) {
        const requestedPlan = data.split('_')[2];
        const plan = plansData.find(p => p.requestedPlan === requestedPlan);

        if (!plan) {
            return safeSendMessage(chatId, '❌ خطای پلن. لطفاً مجدداً از ابتدا شروع کنید.');
        }

        const state = userStates[chatId];
        if (!state) {
            return safeSendMessage(chatId, '❌ خطای وضعیت. لطفاً با /start مجدداً شروع کنید.');
        }

        // ذخیره پلن انتخابی
        state.requestedPlan = requestedPlan;
        
        // --- کیبورد تعداد کاربر ---
        const usersKeyboard = {
            inline_keyboard: [
                [{ text: '۱ کاربر', callback_data: 'users_1' }],
                [{ text: '۲ کاربر (۵۰% تخفیف)', callback_data: 'users_2' }, { text: '۳ کاربر (۱۰۰% تخفیف)', callback_data: 'users_3' }],
                [{ text: '۴ کاربر', callback_data: 'users_4' }, { text: '۵ کاربر', callback_data: 'users_5' }],
                [{ text: '⬅️ بازگشت به پلن‌ها', callback_data: state.type === 'purchase' ? 'menu_purchase' : 'state_renew' }]
            ]
        };

        const baseAmount = plan.baseAmount;
        
        let messageText = `**${plan.icon} ${plan.duration}** انتخاب شد.\n\n`;
        messageText += `قیمت پایه (۱ کاربره): ${formatAmount(baseAmount)} تومان.\n\n`;
        messageText += `لطفاً تعداد کاربران مورد نیاز خود را انتخاب کنید:\n\n`;
        
        // به‌روزرسانی پیام برای انتخاب تعداد کاربر
        state.step = 'awaiting_users_count';
        return safeEditMessageText(messageText, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: usersKeyboard,
            parse_mode: 'Markdown'
        });
    }
    
    // --- ۳. مدیریت انتخاب تعداد کاربر ---
    if (data.startsWith('users_')) {
        const users = parseInt(data.split('_')[1]);
        const state = userStates[chatId];
        
        if (!state || state.step !== 'awaiting_users_count') return;
        
        const plan = plansData.find(p => p.requestedPlan === state.requestedPlan);
        if (!plan) return;
        
        // ذخیره تعداد کاربران
        state.users = users;
        
        const originalAmount = calculateMultiUserPrice(plan.baseAmount, users);
        
        let messageText = `✅ **${users} کاربر** انتخاب شد.\n`;
        messageText += `قیمت نهایی: **${formatAmount(originalAmount)}** تومان.\n\n`;
        
        // هدایت به مرحله بعد
        if (state.type === 'purchase') {
            // خرید جدید: مرحله بعدی وارد کردن کوپن است
            state.step = 'awaiting_coupen_code';
            messageText += `لطفاً کد تخفیف (کوپن) خود را وارد کنید.\n\n اگر کد تخفیف ندارید، دستور /skip را ارسال کنید.`;
            
            return safeEditMessageText(messageText, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                 reply_markup: {
                    inline_keyboard: [
                        [{ text: '⬅️ بازگشت به کاربران', callback_data: `plan_select_${state.requestedPlan}` }]
                    ]
                }
            });
            
        } else if (state.type === 'renew') {
            // تمدید: مرحله قبلاً (awaiting_renewal_id) انجام شده، به مرحله کوپن بروید
            state.step = 'awaiting_coupen_code'; // مرحله کوپن
             messageText += `لطفاً کد تخفیف (کوپن) خود را وارد کنید.\n\n اگر کد تخفیف ندارید، دستور /skip را ارسال کنید.`;
             
             return safeEditMessageText(messageText, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                 reply_markup: {
                    inline_keyboard: [
                        [{ text: '⬅️ بازگشت به کاربران', callback_data: `plan_select_${state.requestedPlan}` }]
                    ]
                }
            });
        }
    }
    
    // --- ۴. تأیید نهایی و شروع پرداخت ---
    if (data === 'final_confirm_yes') {
        const state = userStates[chatId];
        if (!state || state.step !== 'final_confirmation') {
            return safeSendMessage(chatId, '❌ خطای وضعیت. لطفاً با /start مجدداً شروع کنید.');
        }

        const plan = plansData.find(p => p.requestedPlan === state.requestedPlan);
        const description = `${state.type === 'purchase' ? 'خرید' : 'تمدید'} ${plan.duration} برای ${state.name} (${state.email})`;
        
        const payload = {
            amount: state.amount,
            description: description,
            chat_id: chatId,
            name: state.name,
            email: state.email,
            phone: state.phone,
            renewalIdentifier: state.renewalIdentifier || '', // برای تمدید
            requestedPlan: state.requestedPlan,
            coupenCode: state.coupenCode || '',
            telegramUsername: query.from.username || 'N/A', 
            telegramId: query.from.id,
            users: state.users
        };

        try {
            // فراخوانی تابع شروع پرداخت در سرورلس
            const response = await fetch(`${APP_URL}/api/start-payment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const responseData = await response.json();

            if (response.ok && responseData.authority) {
                const paymentLink = `https://www.zarinpal.com/pg/StartPay/${responseData.authority}`;
                
                // ارسال لینک پرداخت (ایمن)
                safeSendMessage(chatId, '🔗 لینک پرداخت شما آماده شد. لطفاً پرداخت را از طریق دکمه زیر تکمیل کنید:', {
                    reply_markup: { inline_keyboard: [[{ text: '💳 پرداخت آنلاین', url: paymentLink }]] }
                });
                
                // حذف کیبورد قبلی (تأیید نهایی) (ایمن)
                safeEditMessageText(query.message.text, { // متن قبلی را حفظ کن
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: { inline_keyboard: [] }, // حذف دکمه‌ها
                    parse_mode: 'Markdown'
                });
                
            } else {
                throw new Error(responseData.details || 'سرور درگاه پرداخت پاسخ نداد.');
            }
        } catch (error) {
            console.error('Payment Error:', error.message);
            safeSendMessage(chatId, '❌ خطای سرور در شروع پرداخت. لطفاً بعداً تلاش کنید.');
        }

        // پس از شروع پرداخت، وضعیت تمدید/خرید را حذف می‌کنیم
        delete userStates[chatId];
    }
    
    
    // --- مدیریت منوی برنامه‌ها ---
    if (data === 'menu_apps') {
        return safeEditMessageText('📱 لطفاً سیستم عامل خود را برای مشاهده برنامه‌های پیشنهادی انتخاب کنید:', {
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

        return safeEditMessageText(`✅ برنامه‌های پیشنهادی برای **${typeText}**:`, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'Markdown'
        });
    }

});


// --- تابع اصلی Vercel Serverless/Webhook ---
module.exports = async (req, res) => {
    
    // فقط درخواست‌های POST را پردازش کنید (Webhook)
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    // تلگرام یک شیء آپدیت در بدنه درخواست POST ارسال می‌کند.
    const update = req.body;
    
    try {
        if (update.message) {
            const chatId = update.message.chat.id;
            const text = update.message.text;

            // **تغییر ۷: مدیریت مستقیم /start**
            if (text === '/start') {
                const welcomeMessage = `سلام شــــامـــــــــای عزیز! به ربات خرید و تمدید اشتراک **Ay Technic** خوش آمدید.\n\nلطفاً برای ادامه یکی از گزینه‌های زیر را انتخاب کنید:`;
                
                // پاک کردن وضعیت فعلی کاربر
                delete userStates[chatId]; 

                // استفاده از fetch مستقیم برای تضمین پاسخگویی به /start
                await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: welcomeMessage,
                        reply_markup: mainMenu,
                        parse_mode: 'Markdown'
                    })
                }).catch(err => console.error("Direct Fetch /start Send Message Error:", err.message));
                
                // نیازی به ادامه processUpdate نیست چون /start مدیریت شد.
                return res.status(200).send('OK (Handled /start)');
            }
        }
        
        // **تغییر ۸: ارسال آپدیت به Listenerهای ربات:**
        // برای تمام آپدیت‌های دیگر (Callback Queries و Messageهای متنی غیر /start)
        bot.processUpdate(update);
        
        // **تغییر ۹: پاسخ سریع به تلگرام:**
        // این پاسخ 200 OK تضمین می‌کند که تلگرام وب‌هوک شما را موفقیت‌آمیز تلقی کرده و آن را لغو نکند.
        res.status(200).send('OK');

    } catch (error) {
        // اگر خطای غیرمنتظره‌ای در processUpdate رخ داد، آن را لاگ می‌کنیم
        console.error('Webhook Processing Error (Final Catch):', error.message);
        res.status(200).send('Error Processed'); // همچنان 200 ارسال می‌کنیم
    }
};
