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
  from: "support@wattorbit.in",
  to: "surajsur2007@gmail.com",
  subject: "Titan SMTP Test",
  text: "SMTP working successfully"
});
