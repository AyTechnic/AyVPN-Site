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

// **اصلاح حیاتی برای Vercel: غیرفعال کردن Polling**
const bot = new TelegramBot(TOKEN, { polling: false }); 

const COUPEN_SHEET_TITLE = 'Coupen';
const userStates = {};
const adminChatId = '5976170456'; // آیدی ادمین

// --- داده های ربات (منو و پلن‌ها) ---
const plans = {
    unlimited: [
        { text: '💎 ۱ ماهه نامحدود - ۱۲۰,۰۰۰ تومان', amount: 120000, key: '1M' },
        { text: '🚀 ۲ ماهه نامحدود - ۲۲۰,۰۰۰ تومان', amount: 220000, key: '2M' },
        { text: '🌟 ۳ ماهه نامحدود - ۳۴۰,۰۰۰ تومان', amount: 340000, key: '3M' },
        { text: '🔥 ۶ ماهه نامحدود - ۶۰۰,۰۰۰ تومان', amount: 600000, key: '6M' },
        { text: '🛡️ ۱ ساله نامحدود - ۱,۰۰۰,۰۰۰ تومان', amount: 1000000, key: '1Y' },
        { text: '👑 ۲ ساله نامحدود - ۲,۰۰۰,۰۰۰ تومان', amount: 2000000, key: '2Y' },
    ],
    national: [
        { text: '🇮🇷 ۱ ماهه ملی - ۵۰,۰۰۰ تومان', amount: 50000, key: 'N1M' },
        { text: '🇮🇷 ۲ ماهه ملی - ۹۰,۰۰۰ تومان', amount: 90000, key: 'N2M' },
        { text: '🇮🇷 ۳ ماهه ملی - ۱۳۰,۰۰۰ تومان', amount: 130000, key: 'N3M' },
        { text: '🇮🇷 ۶ ماهه ملی - ۲۴۰,۰۰۰ تومان', amount: 240000, key: 'N6M' },
        { text: '🇮🇷 ۱ ساله ملی - ۴۵۰,۰۰۰ تومان', amount: 450000, key: 'N1Y' },
        { text: '🇮🇷 ۲ ساله ملی - ۸۵۰,۰۰۰ تومان', amount: 850000, key: 'N2Y' },
    ]
};

const apps = {
    android: [
        { text: 'Ay VPN Plus', url: 'https://t.me/Ay_VPN/62' },
        { text: 'v2rayNG', url: 'https://t.me/Ay_VPN/14' },
    ],
    ios: [
        { text: 'ShadowRocket', url: 'https://t.me/Ay_VPN/63' },
        { text: 'v2Box', url: 'https://t.me/Ay_VPN/63' },
    ],
    windows: [
        { text: 'NekoRay', url: 'https://t.me/Ay_VPN/13' },
    ],
    mac: [
        { text: 'V2rayU', url: 'https://t.me/Ay_VPN/55' },
    ]
};

// --- منوها ---
const mainMenu = {
    inline_keyboard: [
        [{ text: '🛒 خرید اشتراک جدید', callback_data: 'menu_buy' }],
        [{ text: '🔄 تمدید اشتراک', callback_data: 'menu_renew' }],
        [{ text: '🛠️ پشتیبانی', url: 'https://t.me/AyVPNsupport' }],
        [{ text: '📱 نصب برنامه‌ها', callback_data: 'menu_apps' }],
    ]
};

const buyMenu = {
    inline_keyboard: [
        [{ text: '🌍 اشتراک نامحدود', callback_data: 'buy_type_unlimited' }],
        [{ text: '🇮🇷 اشتراک ملی (فقط ایران)', callback_data: 'buy_type_national' }],
        [{ text: '⬅️ بازگشت به منو اصلی', callback_data: 'menu_main' }],
    ]
};

const renewMenu = {
    inline_keyboard: [
        [{ text: '🌍 تمدید نامحدود', callback_data: 'renew_type_unlimited' }],
        [{ text: '🇮🇷 تمدید ملی', callback_data: 'renew_type_national' }],
        [{ text: '⬅️ بازگشت به منو اصلی', callback_data: 'menu_main' }],
    ]
};

const appsMenu = {
    inline_keyboard: [
        [{ text: 'اندروید', callback_data: 'apps_android' }, { text: 'iOS', callback_data: 'apps_ios' }],
        [{ text: 'ویندوز', callback_data: 'apps_windows' }, { text: 'مک', callback_data: 'apps_mac' }],
        [{ text: '⬅️ بازگشت به منو اصلی', callback_data: 'menu_main' }],
    ]
};

// --- توابع کمکی ---
const editOrSendMessage = (chatId, text, options) => {
    // تابعی برای ویرایش یا ارسال پیام جدید (برای Callbacks)
    if (options.message_id) {
        return bot.editMessageText(text, { chat_id: chatId, ...options }).catch(() => bot.sendMessage(chatId, text, options));
    }
    return bot.sendMessage(chatId, text, options);
};

// --- هندلرهای اصلی ---

// 1. هندلر دستور /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    userStates[chatId] = { step: 'menu_main' };
    bot.sendMessage(chatId, '✋ سلام! به ربات خرید و تمدید اشتراک Ay Technic خوش آمدید.', {
        reply_markup: mainMenu
    });
});

// 2. هندلر پیام‌های متنی (برای ورود اطلاعات در استیت‌ها)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text.startsWith('/')) { // ignore commands
        return;
    }

    const state = userStates[chatId];
    if (!state) return;

    const editMessageText = (newText, options = {}) => bot.editMessageText(newText, { chat_id: chatId, message_id: state.messageId, ...options });
    
    try {
        if (state.step === 'awaiting_renewal_identifier') {
            state.renewalIdentifier = text.trim();
            state.step = 'awaiting_user_count';
            return editMessageText(`🔗 لینک یا شناسه تمدید: ${state.renewalIdentifier}\n\n🔢 لطفاً تعداد کاربران مورد نظر را وارد کنید (مثلاً 1, 2, 3):`);
        }

        if (state.step === 'awaiting_user_count') {
            const users = parseInt(text.trim());
            if (isNaN(users) || users <= 0) {
                return editMessageText(`⚠️ تعداد کاربران نامعتبر است. لطفاً یک عدد صحیح بزرگتر از ۰ وارد کنید.`);
            }
            state.users = users;
            state.step = 'awaiting_coupen';
            return editMessageText(`👤 تعداد کاربران: ${state.users} نفر\n\n✂️ اگر کد تخفیف دارید، آن را وارد کنید. در غیر این صورت، عبارت **'ندارم'** را ارسال کنید:`);
        }

        if (state.step === 'awaiting_coupen') {
            state.coupenCode = (text.trim().toLowerCase() === 'ندارم') ? '' : text.trim();
            state.step = 'awaiting_name';
            return editMessageText(`🏷️ کد تخفیف: ${state.coupenCode || 'ندارم'}\n\n✍️ لطفاً نام و نام خانوادگی خود را وارد کنید:`);
        }

        if (state.step === 'awaiting_name') {
            state.name = text.trim();
            state.step = 'awaiting_phone';
            return editMessageText(`👤 نام کامل: ${state.name}\n\n📞 لطفاً شماره موبایل خود را وارد کنید (مثلاً 0912xxxxxxx):`);
        }

        if (state.step === 'awaiting_phone') {
            state.phone = text.trim();
            state.step = 'awaiting_email';
            return editMessageText(`📱 شماره موبایل: ${state.phone}\n\n📧 لطفاً آدرس ایمیل خود را وارد کنید (اختیاری است، اگر ندارید 'ندارم' را وارد کنید):`);
        }

        if (state.step === 'awaiting_email') {
            state.email = (text.trim().toLowerCase() === 'ندارم') ? '' : text.trim();
            state.step = 'awaiting_description';
            return editMessageText(`✉️ ایمیل: ${state.email || 'ندارم'}\n\n📝 لطفاً توضیحات یا نام کاربری تلگرام (برای ارتباط بهتر) را وارد کنید (اختیاری است، اگر ندارید 'ندارم' را وارد کنید):`);
        }
        
        if (state.step === 'awaiting_description') {
            state.description = (text.trim().toLowerCase() === 'ندارم') ? '' : text.trim();
            state.step = 'confirm_payment';
            
            // نمایش اطلاعات نهایی و دکمه پرداخت
            const finalPlan = plans[state.planType].find(p => p.amount === state.amount);
            
            let finalMessage = `
✅ **تایید نهایی سفارش**

* نوع پلن: ${finalPlan.text}
* تعداد کاربران: ${state.users} نفر
* کد تخفیف: ${state.coupenCode || 'ندارم'}
* نام کامل: ${state.name}
* موبایل: ${state.phone}
* ایمیل: ${state.email || 'ندارم'}
* توضیحات/تلگرام: ${state.description || 'ندارم'}
            `;
            
            // چک کردن کوپن و محاسبه قیمت نهایی
            let finalAmountToman = finalPlan.amount;
            let discountAmountToman = 0;
            let coupenError = null;

            if (state.coupenCode) {
                const response = await fetch(`${APP_URL}/api/check-coupon`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ coupenCode: state.coupenCode, originalAmount: finalPlan.amount }),
                });
                
                const result = await response.json();
                
                if (response.ok && result.success) {
                    discountAmountToman = result.discountAmount;
                    finalAmountToman = finalPlan.amount - discountAmountToman;
                } else {
                    coupenError = result.error || 'کد تخفیف نامعتبر است.';
                }
            }

            // محاسبه چند کاربره (این بخش باید طبق منطق start-payment باشد)
            const multiUserPrice = calculateMultiUserPrice(finalPlan.amount, state.users);
            finalAmountToman = multiUserPrice - discountAmountToman;
            if (finalAmountToman < 1000) finalAmountToman = 1000;
            
            finalMessage += `\n\n* **مبلغ نهایی پرداخت:** ${finalAmountToman.toLocaleString('fa-IR')} تومان`;
            if (discountAmountToman > 0) finalMessage += ` (تخفیف: ${discountAmountToman.toLocaleString('fa-IR')} تومان)`;
            if (coupenError) finalMessage += `\n\n❌ **خطا:** ${coupenError}`;

            const paymentKeyboard = {
                inline_keyboard: [
                    [{ text: `💳 پرداخت مبلغ ${finalAmountToman.toLocaleString('fa-IR')} تومان`, callback_data: 'pay_now' }],
                    [{ text: '❌ انصراف و شروع مجدد', callback_data: 'menu_main' }],
                ]
            };
            
            return editMessageText(finalMessage, { 
                reply_markup: paymentKeyboard, 
                parse_mode: 'Markdown' 
            });
        }
    } catch (error) {
        console.error('Bot Message Error:', error.message);
        bot.sendMessage(chatId, `❌ متأسفانه خطایی رخ داد: ${error.message}. لطفاً با /start دوباره شروع کنید.`);
        delete userStates[chatId];
    }
});

// 3. هندلر Callback Query (کلیک روی دکمه‌ها)
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    // تابع کمکی برای پاسخ و ویرایش پیام
    const editOrSendMessage = (text, options = {}) => bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options });

    // بازگشت به منو اصلی
    if (data === 'menu_main') {
        delete userStates[chatId];
        userStates[chatId] = { step: 'menu_main', messageId: messageId };
        return editOrSendMessage('✋ سلام! لطفاً یکی از گزینه‌های زیر را انتخاب کنید:', { reply_markup: mainMenu });
    }

    // --- مدیریت فرآیند خرید/تمدید ---

    if (data === 'menu_buy' || data === 'menu_renew') {
        const isRenew = data === 'menu_renew';
        userStates[chatId] = { step: 'awaiting_plan_type', isRenew: isRenew, messageId: messageId };
        
        const text = isRenew ? '🔄 لطفاً نوع اشتراک جهت تمدید را انتخاب کنید:' : '🛒 لطفاً نوع اشتراک مورد نظر برای خرید را انتخاب کنید:';
        const keyboard = isRenew ? renewMenu : buyMenu;
        return editOrSendMessage(text, { reply_markup: keyboard });
    }

    // انتخاب نوع پلن (خرید و تمدید)
    if (data.startsWith('buy_type_') || data.startsWith('renew_type_')) {
        const type = data.split('_')[2]; // unlimited or national
        userStates[chatId].planType = type;
        
        const planList = plans[type];
        const keyboard = planList.map(p => ([{ text: p.text, callback_data: `select_plan_${p.key}` }]));
        keyboard.push([{ text: '⬅️ بازگشت', callback_data: userStates[chatId].isRenew ? 'menu_renew' : 'menu_buy' }]);

        const typeText = type === 'unlimited' ? 'نامحدود' : 'ملی';
        const actionText = userStates[chatId].isRenew ? 'تمدید' : 'خرید';
        
        return editOrSendMessage(`✅ پلن‌های موجود برای ${actionText} ${typeText}. لطفاً یکی را انتخاب کنید:`, { reply_markup: { inline_keyboard: keyboard } });
    }

    // انتخاب پلن (مقدار)
    if (data.startsWith('select_plan_')) {
        const planKey = data.split('_')[2]; // 1M, N3M, etc.
        const planType = userStates[chatId].planType;
        const selectedPlan = plans[planType].find(p => p.key === planKey);

        if (!selectedPlan) {
            return editOrSendMessage('⚠️ پلن نامعتبر است. لطفاً دوباره تلاش کنید.');
        }

        userStates[chatId].amount = selectedPlan.amount;
        userStates[chatId].requestedPlan = selectedPlan.key;
        
        if (userStates[chatId].isRenew) {
            userStates[chatId].step = 'awaiting_renewal_identifier';
            return editOrSendMessage(`پلن انتخابی: ${selectedPlan.text}\n\n🆔 لطفاً **لینک اشتراک یا شناسه** خود را جهت تمدید وارد کنید:`);
        } else {
            userStates[chatId].step = 'awaiting_user_count';
            return editOrSendMessage(`پلن انتخابی: ${selectedPlan.text}\n\n🔢 لطفاً تعداد کاربران مورد نظر را وارد کنید (مثلاً 1, 2, 3):`);
        }
    }
    
    // دکمه پرداخت نهایی (pay_now)
    if (data === 'pay_now' && userStates[chatId] && userStates[chatId].step === 'confirm_payment') {
        const state = userStates[chatId];
        const finalPlan = plans[state.planType].find(p => p.amount === state.amount);
        
        const finalAmountToman = calculateMultiUserPrice(finalPlan.amount, state.users); // قیمت نهایی را دوباره محاسبه می‌کند
        
        const payload = {
            requestedPlan: state.requestedPlan,
            users: state.users.toString(),
            coupenCode: state.coupenCode || '',
            name: state.name,
            email: state.email,
            phone: state.phone,
            renewalIdentifier: state.renewalIdentifier || '',
            chat_id: chatId.toString(),
            telegramUsername: query.from.username || '',
            telegramId: query.from.id.toString(),
            description: state.description || '',
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
                return editOrSendMessage('🔗 لینک پرداخت شما آماده شد. لطفاً پرداخت را از طریق دکمه زیر تکمیل کنید:', {
                    reply_markup: { inline_keyboard: [[{ text: '💳 پرداخت آنلاین', url: paymentLink }]] }
                });
            } else {
                throw new Error(responseData.details || 'سرور درگاه پرداخت پاسخ نداد.');
            }
        } catch (error) {
            console.error('Payment Error:', error.message);
            bot.sendMessage(chatId, `❌ خطای سرور در شروع پرداخت: ${error.message}`);
        }
        delete userStates[chatId];
    }
    
    // منوی برنامه‌ها
    if (data === 'menu_apps') {
        return editOrSendMessage('📱 لطفاً سیستم عامل خود را انتخاب کنید:', { reply_markup: appsMenu });
    }

    if (data.startsWith('apps_')) {
        const type = data.split('_')[1];
        const appList = apps[type];
        const typeText = { android: 'اندروید', ios: 'iOS', windows: 'ویندوز', mac: 'مک' }[type];
        const keyboard = appList.map(a => ([{ text: a.text, url: a.url }]));
        keyboard.push([{ text: '⬅️ بازگشت به برنامه‌ها', callback_data: 'menu_apps' }]);
        keyboard.push([{ text: '⬅️ بازگشت به منو اصلی', callback_data: 'menu_main' }]);
        return editOrSendMessage(`✅ برنامه‌های پیشنهادی برای **${typeText}**:`, { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown' });
    }
    
    bot.answerCallbackQuery(query.id).catch(() => {});
});

// --- ** تابع اصلی Webhook برای Vercel ** ---
module.exports = async (req, res) => {
    // بررسی می‌کند که آیا درخواست از تلگرام (POST) است یا نه
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    try {
        // دریافت به‌روزرسانی از بادی درخواست
        const update = req.body;

        // وب‌هوک را به کتابخانه node-telegram-bot-api تحویل می‌دهد
        bot.processUpdate(update);

        // پاسخگویی سریع به تلگرام برای جلوگیری از خطای Timeout
        res.status(200).send('OK');

    } catch (error) {
        console.error('Webhook Processing Error:', error.message);
        res.status(500).send('Error processing webhook');
    }
};

// --- توابع کمکی Google Sheet (خارج از Webhook) ---
async function getDoc() { /* ... منطق اتصال به شیت ... */ }
async function getCoupenDetails(coupenCode) { /* ... منطق بررسی کوپن ... */ }
// توجه: برای سادگی، توابع getDoc و getCoupenDetails در اینجا حذف شدند اما فرض می‌شود در کد شما وجود دارند یا فراخوانی می‌شوند.
// (اگر نیاز دارید که این توابع را هم به‌طور کامل قرار دهم، بفرمایید.)
