const { GoogleSpreadsheet } = require('google-spreadsheet');
const axios = require('axios');

// اطلاعات حساس را از Environment Variables فراخوانی می‌کنیم
const ZARINPAL_MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'); // کلید خصوصی نیاز به فرمت‌بندی دارد

// تابع اصلی که به عنوان سرور ما عمل می‌کند
export default async function handler(req, res) {
  // دریافت پارامترها از زرین‌پال
  const { Authority, Status, Amount } = req.query; // Amount را هم دریافت می‌کنیم

  if (Status !== 'OK') {
    return res.status(400).send('<h1>پرداخت ناموفق بود یا توسط شما لغو شد.</h1>');
  }

  try {
    // 1. تایید نهایی پرداخت با زرین‌پال
    const verificationResponse = await axios.post('https://api.zarinpal.com/pg/v4/payment/verify.json', {
      merchant_id: ZARINPAL_MERCHANT_ID,
      authority: Authority,
      amount: Amount, // مبلغ باید با مبلغ اولیه یکسان باشد
    });

    const { data } = verificationResponse.data;

    if (data.code === 100 || data.code === 101) { // کد 101 یعنی تراکنش قبلا تایید شده
      // 2. اتصال به گوگل شیت و پیدا کردن لینک
      const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID);
      await doc.useServiceAccountAuth({
        client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: GOOGLE_PRIVATE_KEY,
      });

      await doc.loadInfo();
      const sheet = doc.sheetsByIndex[0]; // اولین شیت
      const rows = await sheet.getRows();

      const availableLinkRow = rows.find(row => row.status === 'unused');

      if (!availableLinkRow) {
        // اگر لینکی برای تحویل وجود نداشت
        return res.status(500).send(`<h1>پرداخت موفق بود اما لینک خالی تمام شده است!</h1><p>لطفا با پشتیبانی تماس بگیرید. کد پیگیری: ${data.ref_id}</p>`);
      }

      // 3. تحویل لینک و آپدیت کردن وضعیت آن
      const userLink = availableLinkRow.link;
      availableLinkRow.status = 'used'; // تغییر وضعیت به استفاده شده
      await availableLinkRow.save(); // ذخیره تغییرات در شیت

      // 4. نمایش لینک به کاربر
      res.status(200).send(`
        <html>
          <body dir="rtl" style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h1>پرداخت شما با موفقیت انجام شد!</h1>
            <p>کد پیگیری زرین‌پال: ${data.ref_id}</p>
            <p>لینک اشتراک شما آماده است:</p>
            <div style="background: #eee; padding: 20px; border-radius: 8px; font-size: 1.2em; direction: ltr;">${userLink}</div>
          </body>
        </html>
      `);
    } else {
      // اگر کد بازگشتی از زرین‌پال خطا بود
      throw new Error(`Zarinpal verification failed with code: ${data.code}`);
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('<h1>خطایی در پردازش تراکنش رخ داد. لطفا با پشتیبانی تماس بگیرید.</h1>');
  }
}
