const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,       // in-v3.mailjet.com
  port: Number(process.env.SMTP_PORT), // 587
  secure: false, // MUST be false for 587
  auth: {
    user: process.env.SMTP_USER,     // Mailjet API Key
    pass: process.env.SMTP_PASS      // Mailjet Secret Key
  },
  tls: {
    rejectUnauthorized: false        // ✅ IMPORTANT for Render / cloud
  },
  connectionTimeout: 10000,          // 10s
  greetingTimeout: 10000,
  socketTimeout: 10000
});

// Verify SMTP connection
transporter.verify((error) => {
  if (error) {
    console.error("❌ SMTP VERIFY FAILED:", error);
  } else {
    console.log("✅ Mailjet SMTP READY");
  }
});

module.exports = transporter;
