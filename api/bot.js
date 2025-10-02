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

const bot = new TelegramBot(TOKEN); 

const COUPEN_SHEET_TITLE = 'Coupen';
const userStates = {};

// --- توابع کمکی Google Sheet ---
async function getDoc() {
    const serviceAccountAuth = new JWT({
        email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    return doc;
}

// تابع دریافت کوپن از شیت (با ستون‌های اصلاح شده)
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
        const coupenRow = rows.find(row => row.get('coupen') && row.get('coupen').toLowerCase() === coupenCode.toLowerCase());

        if (coupenRow) {
            const expiryDate = coupenRow.get('expiryDate');
            const manyTimes = coupenRow.get('manyTimes');
            
            if (expiryDate && new Date(expiryDate) < new Date()) {
                return { error: 'تاریخ انقضای این کد تخفیف گذشته است.' };
            }
            
            if (manyTimes && manyTimes !== 'unlimited' && parseInt(manyTimes) <= 0) {
                 return { error: 'ظرفیت استفاده از این کد تخفیف به پایان رسیده است.' };
            }
            
            return {
                coupen: coupenRow.get('coupen'),
                percent: parseInt(coupenRow.get('percent')) || 0,
                price: parseInt(coupenRow.get('price')) || 0,
                manyTimes: manyTimes,
                description: coupenRow.get('description'),
                row: coupenRow 
            };
        }
        
        return null; // کوپن یافت نشد
    } catch (error) {
        console.error('Error fetching coupen details:', error.message);
        return { error: 'خطای سیستمی در بررسی کوپن.' };
    }
}

// تابع محاسبه قیمت چند کاربره
const calculateMultiUserPrice = (basePrice, users) => {
    if (users <= 1) return basePrice;
    const multiplier = 1 + (users - 1) * 0.5;
    return Math.round(basePrice * multiplier / 1000) * 1000;
};

// تابع اعمال تخفیف
const applyCoupenDiscount = (originalAmount, coupenDetails) => {
    let finalAmount = originalAmount;
    let discountAmount = 0;
    
    if (coupenDetails) {
        if (coupenDetails.percent > 0) {
            discountAmount = Math.round(originalAmount * coupenDetails.percent / 100);
        } else if (coupenDetails.price > 0) {
            discountAmount = coupenDetails.price;
        }
        finalAmount = originalAmount - discountAmount;
        if (finalAmount < 1000) {
            finalAmount = 1000; 
            discountAmount = originalAmount - 1000;
        }
    }
    return { finalAmount, discountAmount };
};

const formatAmount = (amount) => amount.toLocaleString('fa-IR');

const plansData = [
    { duration: '۱ ماهه', baseAmount: 120000, durationDays: 30, type: 'unlimited', icon: '💎', requestedPlan: '30D' },
    { duration: '۲ ماهه', baseAmount: 220000, durationDays: 60, type: 'unlimited', icon: '🚀', requestedPlan: '60D' },
    { duration: '۳ ماهه', baseAmount: 340000, durationDays: 90, type: 'unlimited', icon: '🌟', requestedPlan: '90D' },
    { duration: '۶ ماهه', baseAmount: 600000, durationDays: 180, type: 'unlimited', icon: '🔥', requestedPlan: '180D' },
    { duration: '۱ ساله', baseAmount: 1000000, durationDays: 365, type: 'unlimited', icon: '👑', requestedPlan: '365D' },
    { duration: '۲ ساله', baseAmount: 2000000, durationDays: 730, type: 'unlimited', icon: '♾️', requestedPlan: '730D' },
];

const apps = {
    android: [{ text: 'V2rayNG', url: 'https://play.google.com/store/apps/details?id=com.v2ray.ang' }],
    ios: [{ text: 'Shadowrocket', url: 'https://apps.apple.com/us/app/shadowrocket/id932747118' }],
    windows: [{ text: 'V2rayN', url: 'https://github.com/2dust/v2rayN/releases' }],
    mac: [{ text: 'V2RayX', url: 'https://github.com/Cenmrev/V2RayX/releases' }]
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

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    const welcomeMessage = `سلام ${msg.from.first_name} عزیز! به ربات خرید و تمدید اشتراک **Ay Technic** خوش آمدید.\n\nلطفاً برای ادامه یکی از گزینه‌های زیر را انتخاب کنید:`;
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

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/') || !userStates[chatId]) return;

    const state = userStates[chatId];
    const step = state.step;

    if (step === 'waiting_for_renew_id') {
        state.renewalIdentifier = text;
        state.step = 'waiting_for_renew_coupen';
        return bot.sendMessage(chatId, 'کد تخفیف را وارد کنید (اگر ندارید، **0** را ارسال کنید):', { parse_mode: 'Markdown' });
    }

    if (step === 'waiting_for_track_id') {
        const identifier = text;
        delete userStates[chatId];
        
        try {
            const response = await fetch(`${APP_URL}/api/track?identifier=${encodeURIComponent(identifier)}`);
            if (response.status === 200) {
                const purchases = await response.json();
                let message = `✅ **سفارشات یافت شده برای شناسه ${identifier}:**\n\n`;
                purchases.forEach(p => {
                    const planDisplay = p.plan.endsWith('D') ? `${parseInt(p.plan)} روزه` : (p.plan === 'Renew' ? 'درخواست تمدید' : p.plan);
                    message += `* پلن: ${planDisplay}\n`;
                    message += `* تاریخ: ${p.date}\n`;
                    if (p.link) message += `* لینک اشتراک: \`${p.link}\`\n`;
                    message += `* کد رهگیری: ${p.trackingId}\n`;
                    message += `* وضعیت: موفق\n\n`;
                });
                return bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            } else if (response.status === 404) {
                return bot.sendMessage(chatId, '❌ سفارشی با این شناسه یافت نشد.');
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Server Error');
            }
        } catch (error) {
            console.error('Tracking Error:', error.message);
            return bot.sendMessage(chatId, `❌ خطای سرور در پیگیری سفارش: ${error.message}`);
        }
    }

    if (step === 'waiting_for_purchase_coupen' || step === 'waiting_for_renew_coupen') {
        const coupenCode = text === '0' ? '' : text;
        state.coupenCode = coupenCode;

        const isRenew = step === 'waiting_for_renew_coupen';

        // برای تمدید، مبلغ و پلن ثابت فرض می‌شود (باید با توجه به نیاز تکمیل شود)
        const plan = isRenew ? { baseAmount: 120000, duration: '۱ ماهه تمدید', requestedPlan: '30D' } : plansData.find(p => p.requestedPlan === state.requestedPlan);
        const users = isRenew ? 1 : parseInt(state.users); // فرض تمدید تک کاربره
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
                state.coupenDetails = coupenDetails;
            } else {
                discountMessage = `⚠️ ${(coupenDetails && coupenDetails.error) || 'کد تخفیف نامعتبر است.'} لطفاً کد معتبر وارد کنید یا **0** را ارسال کنید.`;
                return bot.sendMessage(chatId, discountMessage, { parse_mode: 'Markdown' });
            }
        }

        state.finalAmount = finalAmount;
        
        if(isRenew) {
            state.step = 'ready_to_pay_renew';
            const summary = `${discountMessage}
            **خلاصه تمدید شما:**
            * 🔑 شناسه تمدید: ${state.renewalIdentifier}
            * 💵 مبلغ قابل پرداخت: **${formatAmount(finalAmount)} تومان**
            
            آیا برای شروع فرآیند پرداخت آنلاین آماده هستید؟
            `;
            const keyboard = { inline_keyboard: [[{ text: '✅ شروع پرداخت', callback_data: 'pay_start_renew' }], [{ text: '⬅️ بازگشت', callback_data: 'menu_main' }]] };
            return bot.sendMessage(chatId, summary, { reply_markup: keyboard, parse_mode: 'Markdown' });

        } else {
            state.step = 'waiting_for_user_info';
            const message = `${discountMessage}
            💰 مبلغ نهایی: **${formatAmount(finalAmount)} تومان**
            
            لطفاً نام، شماره تماس و ایمیل خود را وارد کنید (اختیاری).
            برای رد شدن، کلمه **رد** را ارسال کنید.
            
            **مثال:** شامای ایرانی، 09121234567، shammay@aytechnic.com
            `;
            return bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        }
    }
    
    if (step === 'waiting_for_user_info') {
        if (text.toLowerCase() === 'رد') {
            state.name = ''; state.phone = ''; state.email = '';
        } else {
            const parts = text.split(/[,،]/).map(p => p.trim());
            state.name = parts[0] || '';
            state.phone = parts[1] || '';
            state.email = parts[2] || '';
        }

        state.step = 'ready_to_pay_purchase';
        const plan = plansData.find(p => p.requestedPlan === state.requestedPlan);
        
        const summary = `**خلاصه سفارش:**
* نام: ${state.name || 'ثبت نشده'}
* تماس: ${state.phone || 'ثبت نشده'}
* ایمیل: ${state.email || 'ثبت نشده'}
* پلن: ${plan.duration}
* تعداد کاربر: ${state.users}
* مبلغ: **${formatAmount(state.finalAmount)} تومان**

آیا برای شروع پرداخت آماده هستید؟`;
        
        const keyboard = { inline_keyboard: [[{ text: '✅ شروع پرداخت', callback_data: 'pay_start_purchase' }], [{ text: '⬅️ بازگشت', callback_data: 'menu_main' }]] };
        return bot.sendMessage(chatId, summary, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
});

bot.on('callback_query', async (query) => {
    const data = query.data;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    const editOrSendMessage = (text, options) => {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options }).catch(() => {
            bot.sendMessage(chatId, text, options); // Fallback if edit fails
        });
    };

    if (data === 'menu_main') {
        delete userStates[chatId];
        const welcomeMessage = `به منوی اصلی خوش آمدید. لطفاً یکی از گزینه‌ها را انتخاب کنید:`;
        const keyboard = {
            inline_keyboard: [
                [{ text: '🛒 خرید اشتراک جدید', callback_data: 'menu_purchase' }],
                [{ text: '🔄 تمدید اشتراک', callback_data: 'state_renew' }],
                [{ text: '🔍 پیگیری سفارش', callback_data: 'state_track' }],
                [{ text: '📱 برنامه‌های پیشنهادی', callback_data: 'menu_apps' }]
            ]
        };
        return editOrSendMessage(welcomeMessage, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }

    if (data === 'menu_purchase') {
        userStates[chatId] = { step: 'awaiting_plan_select' };
        const keyboard = plansData.map(p => ([{ text: `${p.icon} ${p.duration} - ${formatAmount(p.baseAmount)} تومان`, callback_data: `plan_${p.requestedPlan}` }]));
        keyboard.push([{ text: '⬅️ بازگشت', callback_data: 'menu_main' }]);
        return editOrSendMessage('🛍️ لطفاً مدت زمان اشتراک را انتخاب کنید (قیمت برای ۱ کاربر):', { reply_markup: { inline_keyboard: keyboard } });
    }

    if (data.startsWith('plan_')) {
        const requestedPlan = data.split('_')[1];
        userStates[chatId] = { step: 'awaiting_user_select', requestedPlan: requestedPlan };
        const userCountKeyboard = {
            inline_keyboard: [
                [{ text: '👥 ۱ کاربر', callback_data: 'user_1' }, { text: '👥 ۲ کاربر', callback_data: 'user_2' }],
                [{ text: '👥 ۳ کاربر', callback_data: 'user_3' }, { text: '👥 ۴ کاربر', callback_data: 'user_4' }],
                 [{ text: '👥 ۵ کاربر', callback_data: 'user_5' }, { text: '👥 ۶ کاربر', callback_data: 'user_6' }],
                  [{ text: '👥 ۷ کاربر', callback_data: 'user_7' }, { text: '👥 ۸ کاربر', callback_data: 'user_8' }],
                [{ text: '⬅️ بازگشت به پلن‌ها', callback_data: 'menu_purchase' }]
            ]
        };
        const plan = plansData.find(p => p.requestedPlan === requestedPlan);
        return editOrSendMessage(`✅ پلن ${plan.icon} ${plan.duration} انتخاب شد. لطفاً تعداد کاربر را انتخاب کنید:`, { reply_markup: userCountKeyboard });
    }

    if (data.startsWith('user_')) {
        const users = data.split('_')[1];
        const state = userStates[chatId];
        if (!state || state.step !== 'awaiting_user_select') return;
        
        state.users = users;
        state.step = 'waiting_for_purchase_coupen';
        
        const plan = plansData.find(p => p.requestedPlan === state.requestedPlan);
        const originalAmount = calculateMultiUserPrice(plan.baseAmount, parseInt(users));
        
        const message = `✅ **${users} کاربره** انتخاب شد.\n💰 مبلغ اولیه: **${formatAmount(originalAmount)} تومان**\n\nکد تخفیف را وارد کنید (اگر ندارید، **0** را ارسال کنید):`;
        
        await bot.deleteMessage(chatId, messageId).catch(() => {});
        return bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }

    if (data === 'state_track' || data === 'state_renew') {
        await bot.deleteMessage(chatId, messageId).catch(() => {});
        if (data === 'state_track') {
            userStates[chatId] = { step: 'waiting_for_track_id' };
            return bot.sendMessage(chatId, '🔍 لطفاً **کد رهگیری**، **شماره تماس** یا **ایمیل** ثبت شده در سفارش را ارسال کنید:');
        } else {
            userStates[chatId] = { step: 'waiting_for_renew_id' };
            return bot.sendMessage(chatId, '🔄 لطفاً **لینک اشتراک** یا **شناسه تمدید** خود را ارسال کنید:');
        }
    }

    if (data === 'pay_start_purchase' || data === 'pay_start_renew') {
        const state = userStates[chatId];
        if (!state || (state.step !== 'ready_to_pay_purchase' && state.step !== 'ready_to_pay_renew')) return;
        
        const isRenew = data === 'pay_start_renew';
        const plan = plansData.find(p => p.requestedPlan === state.requestedPlan);
        const description = isRenew 
            ? `تمدید اشتراک - شناسه: ${state.renewalIdentifier}`
            : `خرید اشتراک - پلن: ${plan.duration} - کاربر: ${state.users}`;

        const payload = {
            amount: state.finalAmount,
            description: description,
            chat_id: chatId,
            name: state.name || '',
            email: state.email || '',
            phone: state.phone || '',
            renewalIdentifier: isRenew ? state.renewalIdentifier : '',
            requestedPlan: state.requestedPlan,
            coupenCode: state.coupenCode || '',
            telegramUsername: query.from.username || '',
            telegramId: query.from.id.toString(),
            users: state.users || '1',
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
                await editOrSendMessage('🔗 لینک پرداخت شما آماده شد. لطفاً پرداخت را تکمیل کنید:', {
                    reply_markup: { inline_keyboard: [[{ text: '💳 پرداخت آنلاین', url: paymentLink }]] }
                });
            } else {
                throw new Error(responseData.error || 'سرور درگاه پرداخت پاسخ نداد.');
            }
        } catch (error) {
            console.error('Payment Error:', error.message);
            bot.sendMessage(chatId, `❌ خطای سرور در شروع پرداخت: ${error.message}`);
        }
        delete userStates[chatId];
    }
    
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

// ... [بقیه کدهای ربات، تعریف menus، توابع on('message') و on('callback_query') بدون تغییر باقی می‌مانند] ...


// **اصلاح لازم: منطق Webhook برای Vercel**
module.exports = async (req, res) => {
    // بررسی می‌کند که آیا درخواست از تلگرام (POST) است یا نه
    if (req.method !== 'POST') {
        // برای درخواست‌های غیر POST، کد وضعیت 405 (Method Not Allowed) برمی‌گرداند
        return res.status(405).send('Method Not Allowed');
    }

    try {
        // دریافت به‌روزرسانی از بادی درخواست
        const update = req.body;

        // وب‌هوک را به کتابخانه node-telegram-bot-api تحویل می‌دهد
        // این کار باعث می‌شود متدهای bot.on('message') و bot.on('callback_query') اجرا شوند.
        bot.processUpdate(update);

        // پاسخگویی سریع به تلگرام برای جلوگیری از خطای Timeout
        res.status(200).send('OK');

    } catch (error) {
        console.error('Webhook Processing Error:', error.message);
        // در صورت بروز خطا در پردازش، با کد 500 پاسخ می‌دهد
        res.status(500).send('Error processing webhook');
    }
};
