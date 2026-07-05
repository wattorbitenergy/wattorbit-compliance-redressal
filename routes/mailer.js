const dns = require('dns');

// Force IPv4-first globally — helps on PaaS environments
dns.setDefaultResultOrder('ipv4first');

/**
 * Send email via Mailjet REST API using Node's built-in fetch (undici engine).
 * Undici uses a completely different TCP/TLS implementation from Node's https module.
 */
async function sendViaMailjet({ fromEmail, fromName, to, subject, html, attachments }) {
  const auth = Buffer.from(
    `${process.env.MAILJET_API_KEY}:${process.env.MAILJET_SECRET_KEY}`
  ).toString('base64');

  const res = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${auth}`,
    },
    body: JSON.stringify({
      Messages: [{
        From: { Email: fromEmail, Name: fromName },
        To: [{ Email: to }],
        Subject: subject,
        HTMLPart: html,
        Attachments: attachments || [],
      }],
    }),
    signal: AbortSignal.timeout(20000), // 20s timeout
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mailjet ${res.status}: ${text}`);
  }
  return true;
}

/**
 * Send email via Brevo (formerly Sendinblue) REST API.
 * Fallback provider — set BREVO_API_KEY in your environment to enable.
 */
async function sendViaBrevo({ fromEmail, fromName, to, subject, html }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': process.env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName },
      to: [{ email: to }],
      subject: subject,
      htmlContent: html,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Brevo ${res.status}: ${text}`);
  }
  return true;
}

/**
 * Determine which provider to use.
 * Priority: BREVO_API_KEY (if set) > Mailjet
 */
function getProvider() {
  if (process.env.BREVO_API_KEY) return 'brevo';
  return 'mailjet';
}

/**
 * Send email with retry logic. Automatically picks the configured provider.
 */
async function sendWithRetry({ to, subject, html, attachments, from }, retries = 3) {
  const fromEmail = from?.email || from || "support@wattorbit.in";
  const fromName = from?.name || "WattOrbit Support";
  const provider = getProvider();

  console.log(`📧 Sending email to ${to} via ${provider.toUpperCase()}...`);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (provider === "brevo") {
        await sendViaBrevo({ fromEmail, fromName, to, subject, html });
      } else {
        await sendViaMailjet({
          fromEmail,
          fromName,
          to,
          subject,
          html,
          attachments,
        });
      }

      console.log(`✅ Email sent successfully to ${to} via ${provider}`);
      return true;

    } catch (err) {
      console.error("========== FULL ERROR ==========");
      console.error(err);
      console.error("Name:", err.name);
      console.error("Message:", err.message);
      console.error("Code:", err.code);
      console.error("Cause:", err.cause);

      if (err.cause) {
        console.error("Cause code:", err.cause.code);
        console.error("Cause errno:", err.cause.errno);
        console.error("Cause message:", err.cause.message);
        console.error("Cause stack:", err.cause.stack);
      }

      const code = err.code || "";
      const msg = err.message || "";

      const isTransient =
        [
          "ECONNRESET",
          "ECONNREFUSED",
          "ETIMEDOUT",
          "EPIPE",
          "EHOSTUNREACH",
          "EAI_AGAIN",
          "UND_ERR_CONNECT_TIMEOUT",
        ].includes(code) ||
        msg.includes("ECONNRESET") ||
        msg.includes("timed out") ||
        msg.includes("timeout") ||
        msg.includes("abort") ||
        msg.includes("network");

      console.error(
        `❌ ${provider.toUpperCase()} Error (attempt ${attempt}/${retries}):`,
        code || msg
      );

      if (isTransient && attempt < retries) {
        const delay = attempt * 2000;
        console.log(`🔄 Retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      throw err;
    }
  }
}

module.exports = {
  async sendMail(options) {
    return sendWithRetry(options);
  },
};