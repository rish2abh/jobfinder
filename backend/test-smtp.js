/**
 * Quick SMTP connectivity test — run with:
 *   node test-smtp.js
 *
 * Paste your App Password below and confirm it works before putting it in .env
 */
const nodemailer = require('nodemailer');

const USER = 'rishabhshrivastva205@gmail.com';
const PASS = 'PASTE_YOUR_APP_PASSWORD_HERE'; // <-- paste here WITH spaces

async function main() {
  console.log('Testing SMTP connection to smtp.gmail.com:587...');

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: USER, pass: PASS },
  });

  try {
    await transporter.verify();
    console.log('✅  SMTP connection OK — credentials are valid');

    // Optional: send a real test email
    // const info = await transporter.sendMail({
    //   from: USER,
    //   to: USER,
    //   subject: 'SMTP test',
    //   text: 'If you see this, SMTP is working.',
    // });
    // console.log('Test email sent:', info.messageId);
  } catch (err) {
    console.error('❌  SMTP failed:', err.message);
  }
}

main();
