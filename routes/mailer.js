const mailjet = require("node-mailjet").apiConnect(
  process.env.MAILJET_API_KEY,
  process.env.MAILJET_SECRET_KEY
);

/**
 * Attempts to send a mail via Mailjet with retry logic.
 * Retries up to `maxRetries` times on transient network errors (ECONNRESET, ETIMEDOUT, etc.)
 */
async function sendWithRetry({ to, subject, html, attachments, from }, retries = 3) {
  const fromEmail = from?.email || from || "support@wattorbit.in";
  const fromName  = from?.name  || "WattOrbit Support";

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await mailjet
        .post("send", { version: "v3.1" })
        .request({
          Messages: [
            {
              From:        { Email: fromEmail, Name: fromName },
              To:          [{ Email: to }],
              Subject:     subject,
              HTMLPart:    html,
              Attachments: attachments || []
            }
          ]
        });

      // Success
      return true;

    } catch (err) {
      const isTransient = [
        "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT",
        "EPIPE", "EHOSTUNREACH", "EAI_AGAIN"
      ].includes(err.code) || err.message?.includes("ECONNRESET");

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
