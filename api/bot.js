const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const VERCEL_URL = `https://${process.env.VERCEL_URL}`; // آدرس سایت شما در ورسل
const bot = new TelegramBot(TOKEN);

// لیست پلن‌ها و قیمت‌ها
const plans = [
    { text: 'اشتراک ۱ ماهه - ۱۲۰,۰۰۰ تومان', amount: 120000, description: 'اشتراک ۳۰ روزه' },
    { text: 'اشتراک ۲ ماهه - ۲۲۰,۰۰۰ تومان', amount: 220000, description: 'اشتراک ۶۰ روزه' },
    { text: 'اشتراک ۳ ماهه - ۳۴۰,۰۰۰ تومان', amount: 340000, description: 'اشتراک ۹۰ روزه' },
    { text: 'اشتراک ۶ ماهه - ۶۰۰,۰۰۰ تومان', amount: 600000, description: 'اشتراک ۱۸۰ روزه' },
    { text: 'اشتراک ۱ ساله - ۱,۰۰۰,۰۰۰ تومان', amount: 1000000, description: 'اشتراک ۳۶۵ روزه' },
    { text: 'اشتراک ۲ ساله - ۲,۰۰۰,۰۰۰ تومان', amount: 2000000, description: 'اشتراک ۷۳۰ روزه' },
];

// این تابع اصلی است که به درخواست‌های تلگرام پاسخ می‌دهد
module.exports = async (req, res) => {
    const update = req.body;

    try {
        // پاسخ به دستور /start
        if (update.message && update.message.text === '/start') {
            const chatId = update.message.chat.id;
            const options = {
                reply_markup: {
                    inline_keyboard: plans.map(plan => ([{ text: plan.text, callback_data: `plan_${plan.amount}` }]))
                }
            };
            await bot.sendMessage(chatId, '🚀 به ربات فروش اشتراک Ay Technic خوش آمدید!\n\nلطفاً پلن مورد نظر خود را انتخاب کنید:', options);
        }

        // پاسخ به کلیک روی دکمه‌ها
        if (update.callback_query) {
            const chatId = update.callback_query.message.chat.id;
            const chosenPlanData = update.callback_query.data;
            const amount = chosenPlanData.split('_')[1];
            const planDetails = plans.find(p => p.amount == amount);

            if (planDetails) {
                await bot.sendMessage(chatId, `⏳ در حال ساخت لینک پرداخت برای "${planDetails.text}"...`);

                // تماس با تابع start-payment برای گرفتن لینک پرداخت
                const response = await fetch(`${VERCEL_URL}/api/start-payment`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        amount: planDetails.amount,
                        description: planDetails.description,
                        chat_id: chatId // ارسال آیدی چت برای بازگشت پیام
                    }),
                });

                const data = await response.json();

                if (data.authority) {
                    const paymentLink = `https://www.zarinpal.com/pg/StartPay/${data.authority}`;
                    await bot.sendMessage(chatId, '🔗 لینک پرداخت شما آماده شد. لطفاً پرداخت را از طریق دکمه زیر تکمیل کنید:', {
                        reply_markup: {
                            inline_keyboard: [[{ text: '💳 پرداخت آنلاین', url: paymentLink }]]
                        }
                    });
                } else {
                    throw new Error(data.error || 'خطا در ارتباط با درگاه پرداخت.');
                }
            }
        }
    } catch (error) {
        console.error('Bot Error:', error);
    }

    res.status(200).send('OK'); // به تلگرام اطلاع می‌دهیم که پیام را دریافت کردیم
};
