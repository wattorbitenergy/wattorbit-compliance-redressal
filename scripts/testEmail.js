/**************************************************
 * WattOrbit Email Delivery Test
 * Usage: node scripts/testEmail.js recipient@example.com
 **************************************************/

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mailer = require('../routes/mailer');

async function sendTest() {
    const to = process.argv[2];
    if (!to) {
        console.error('❌ Please provide a recipient email. Example: node scripts/testEmail.js your-email@gmail.com');
        process.exit(1);
    }

    console.log(`🚀 Sending test email to: ${to}...`);

    const html = `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: #007bff;">WattOrbit Connectivity Test</h2>
            <p>This is a diagnostic email from your <strong>Railway/Render</strong> backend instance.</p>
            <p>If you received this, your <strong>Mailjet API</strong> configuration is working perfectly! ✅</p>
            <hr>
            <p style="font-size: 12px; color: #999;">Sent at: ${new Date().toLocaleString()}</p>
        </div>
    `;

    try {
        await mailer.sendMail({
            to,
            subject: '✅ WattOrbit Backend Connectivity Test',
            html,
            from: "support@wattorbit.in"
        });
        console.log('✅ Test email SENT successfully! Please check your inbox (and spam folder).');
    } catch (err) {
        console.error('❌ Failed to send test email:', err.message);
    }
    process.exit(0);
}

sendTest();
