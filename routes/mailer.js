const https = require('https');
const dns = require('dns');

// Force IPv4-first globally for this module — fixes ECONNRESET on Render/Railway
// where IPv6 routes to Mailjet are broken
dns.setDefaultResultOrder('ipv4first');

/**
 * Low-level HTTPS POST using Node built-in `https` module.
 * Forces IPv4 via a custom `lookup` function to avoid Render IPv6 issues.
 */
function httpsPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);

    const options = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      // Force IPv4 lookup explicitly
      family: 4,
      lookup: (hostname, opts, cb) => {
        dns.resolve4(hostname, (err, addresses) => {
          if (err) return cb(err);
          cb(null, addresses[0], 4);
        });
      },
      timeout: 20000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, data });
        } else {
          const err = new Error(`Mailjet responded with ${res.statusCode}: ${data}`);
          err.statusCode = res.statusCode;
          reject(err);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      const err = new Error('Request timed out');
      err.code = 'ETIMEDOUT';
      reject(err);
    });

    req.on('error', reject);

    req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Attempts to send a mail via Mailjet REST API with retry logic.
 * Uses Node native https + forced IPv4 to avoid ECONNRESET on PaaS.
 */
async function sendWithRetry({ to, subject, html, attachments, from }, retries = 3) {
  const fromEmail = from?.email || from || "support@wattorbit.in";
  const fromName  = from?.name  || "WattOrbit Support";

  const auth = Buffer.from(
    `${process.env.MAILJET_API_KEY}:${process.env.MAILJET_SECRET_KEY}`
  ).toString('base64');

  const payload = {
    Messages: [
      {
        From: { Email: fromEmail, Name: fromName },
        To: [{ Email: to }],
        Subject: subject,
        HTMLPart: html,
        Attachments: attachments || [],
      },
    ],
  };

  const headers = {
    Authorization: `Basic ${auth}`,
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await httpsPost('https://api.mailjet.com/v3.1/send', payload, headers);
      console.log(`✅ Mailjet email sent successfully to ${to}`);
      return true;

    } catch (err) {
      const code = err.code || '';
      const msg  = err.message || '';
      const isTransient =
        ["ECONNRESET","ECONNREFUSED","ETIMEDOUT","EPIPE","EHOSTUNREACH","EAI_AGAIN"]
          .includes(code) ||
        msg.includes("ECONNRESET") ||
        msg.includes("timed out") ||
        msg.includes("timeout");

      console.error(
        `❌ Mailjet API Error (attempt ${attempt}/${retries}):`,
        code || msg
      );

      if (isTransient && attempt < retries) {
        const delay = attempt * 2000; // 2s, 4s
        console.log(`🔄 Retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      throw err;
    }
  }
}

// Mimics Nodemailer transporter interface
module.exports = {
  async sendMail(options) {
    return sendWithRetry(options);
  },
};
