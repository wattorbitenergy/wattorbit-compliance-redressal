require("dotenv").config();
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

(async () => {
  try {
    const info = await transporter.sendMail({
      from: "WattOrbit Support <support@wattorbit.in>",
      to: "surajsur2007@gmail.com", // 🔁 replace with your email
      subject: "Mailjet SMTP Test – SUCCESS",
      text: "SMTP setup is complete and working.",
      html: "<h2>Mailjet SMTP is working ✅</h2>"
    });

    console.log("✅ TEST MAIL SENT");
    console.log("Message ID:", info.messageId);
  } catch (err) {
    console.error("❌ TEST MAIL FAILED");
    console.error(err.message);
  }
})();
