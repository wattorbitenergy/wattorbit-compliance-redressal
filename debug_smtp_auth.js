require('dotenv').config();
const nodemailer = require('nodemailer');

console.log('--- SMTP AUTH DEBUG ---');
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;

console.log(`User length: ${user ? user.length : 'N/A'}`);
console.log(`Pass length: ${pass ? pass.length : 'N/A'}`);

if (user) {
    console.log(`User first char: '${user[0]}'`);
    console.log(`User last char: '${user[user.length - 1]}'`);
}
if (pass) {
    console.log(`Pass first char: '${pass[0]}'`);
    console.log(`Pass last char: '${pass[pass.length - 1]}'`);
}

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false, // Explicitly false for 587
    auth: {
        user: user,
        pass: pass
    },
    debug: true, // Enable debug output
    logger: true // Log to console
});

transporter.verify((err, success) => {
    if (err) {
        console.error('❌ AUTH FAILED');
        console.error('Error Code:', err.code);
        console.error('Error Command:', err.command);
        console.error('Error Message:', err.message);
    } else {
        console.log('✅ AUTH SUCCESS');
    }
});
