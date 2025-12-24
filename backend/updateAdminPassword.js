const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/User");
require("dotenv").config();

const MONGO_URI = process.env.MONGO_URI;

async function updateAdminPassword() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB");

    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);

    const result = await User.updateOne(
      { role: "admin" },
      { $set: { password: hash } }
    );

    console.log("✅ Admin password updated in DB");
    console.log(result);

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

updateAdminPassword();
