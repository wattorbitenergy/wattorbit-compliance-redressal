const mailjet = require("node-mailjet").apiConnect(
  process.env.MAILJET_API_KEY,
  process.env.MAILJET_SECRET_KEY
);

// This object mimics Nodemailer transporter
const transporter = {
  async sendMail({ to, subject, html, attachments, from }) {
    try {
      const fromEmail = from?.email || from || "support@wattorbit.in";
      const fromName = from?.name || "WattOrbit Support";

      const request = await mailjet
        .post("send", { version: "v3.1" })
        .request({
          Messages: [
            {
              From: {
                Email: fromEmail,
                Name: fromName
              },
              To: [
                {
                  Email: to
                }
              ],
              Subject: subject,
              HTMLPart: html,
              Attachments: attachments || []
            }
          ]
        });

      // Mailjet success
      return true;
    } catch (err) {
      console.error("❌ Mailjet API Error:", err.message);
      throw err;
    }
  }
};

module.exports = transporter;
