const nodemailer = require('nodemailer');

// Configure Nodemailer to use Mailjet's SMTP server
const transporter = nodemailer.createTransport({
  host: 'in-v3.mailjet.com',
  port: 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.MAILJET_API_KEY,
    pass: process.env.MAILJET_SECRET_KEY,
  },
  // Adding connection options to prevent drops
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 15000,
});

/**
 * Attempts to send a mail via Mailjet SMTP with retry logic.
 * Retries up to `maxRetries` times on transient network errors (ECONNRESET, ETIMEDOUT, etc.)
 */
async function sendWithRetry({ to, subject, html, attachments, from }, retries = 3) {
  const fromEmail = from?.email || from || "support@wattorbit.in";
  const fromName  = from?.name  || "WattOrbit Support";
  
  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to: to,
    subject: subject,
    html: html,
    attachments: attachments || []
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await transporter.sendMail(mailOptions);
      return true; // Success

    } catch (err) {
      const isTransient = [
        "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT",
        "EPIPE", "EHOSTUNREACH", "EAI_AGAIN", "ESOCKETTIMEDOUT"
      ].includes(err.code) || err.message?.includes("ECONNRESET") || err.message?.includes("timeout");

      console.error(
        `❌ Mailjet SMTP Error (attempt ${attempt}/${retries}):`,
        err.code || err.message
      );

      // If it's a transient network error and we have retries left, wait & retry
      if (isTransient && attempt < retries) {
        const delay = attempt * 1500; // 1.5s, 3s, 4.5s
        console.log(`🔄 Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      // Non-transient error or final attempt — rethrow
      throw err;
    }
  }
}

// Mimics our previous custom transporter interface
module.exports = {
  async sendMail(options) {
    return sendWithRetry(options);
  }
};
