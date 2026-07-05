const axios = require('axios');
const https = require('https');

// Create a custom agent to force IPv4 and disable keep-alive 
// to prevent ECONNRESET on environments like Render
const httpsAgent = new https.Agent({
  keepAlive: false,
  family: 4
});

/**
 * Attempts to send a mail via Mailjet with retry logic using Axios directly.
 * Retries up to `maxRetries` times on transient network errors (ECONNRESET, ETIMEDOUT, etc.)
 */
async function sendWithRetry({ to, subject, html, attachments, from }, retries = 3) {
  const fromEmail = from?.email || from || "support@wattorbit.in";
  const fromName  = from?.name  || "WattOrbit Support";
  
  const auth = Buffer.from(`${process.env.MAILJET_API_KEY}:${process.env.MAILJET_SECRET_KEY}`).toString('base64');

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await axios.post(
        'https://api.mailjet.com/v3.1/send',
        {
          Messages: [
            {
              From: { Email: fromEmail, Name: fromName },
              To: [{ Email: to }],
              Subject: subject,
              HTMLPart: html,
              Attachments: attachments || []
            }
          ]
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${auth}`
          },
          httpsAgent,
          timeout: 15000 // 15 seconds timeout
        }
      );

      // Success
      return true;

    } catch (err) {
      const isTransient = [
        "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT",
        "EPIPE", "EHOSTUNREACH", "EAI_AGAIN"
      ].includes(err.code) || err.message?.includes("ECONNRESET") || err.message?.includes("timeout");

      console.error(
        `❌ Mailjet API Error (attempt ${attempt}/${retries}):`,
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

// Mimics Nodemailer transporter interface
const transporter = {
  async sendMail(options) {
    return sendWithRetry(options);
  }
};

module.exports = transporter;
