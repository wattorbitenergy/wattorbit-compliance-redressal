const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.titan.email",
  port: 587,
  secure: false,
  auth: {
    user: "support@wattorbit.in",
    pass: "EMAIL_PASSWORD"
  }
});

transporter.sendMail({
  from: "info@wattorbit.in",
  to: "support@wattorbit.in",
  subject: "Titan SMTP Test",
  text: "SMTP working successfully"
});
