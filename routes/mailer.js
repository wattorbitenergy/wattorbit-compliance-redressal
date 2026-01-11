const mailjet = require("node-mailjet").apiConnect(
  process.env.MAILJET_API_KEY,
  process.env.MAILJET_SECRET_KEY
);

// This object mimics Nodemailer transporter
const transporter = {
  async sendMail({ to, subject, html }) {
    try {
      const request = await mailjet
        .post("send", { version: "v3.1" })
        .request({
          Messages: [
            {
              From: {
                Email: "support@wattorbit.in",
                Name: "WattOrbit Support"
              },
              To: [
                {
                  Email: to
                }
              ],
              Subject: subject,
              HTMLPart: html
            }
          ]
        });

      console.log("✅ Mailjet:", request.body.Messages[0].Status);
      return true;
    } catch (err) {
      console.error("❌ Mailjet API Error:", err.message);
      throw err;
    }
  }
};

module.exports = transporter;
