const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/User");
require("dotenv").config();

const MONGO_URI = process.env.MONGO_URI;

async function createOrUpdateAdmin() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB");

    const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);

    const admin = await User.findOneAndUpdate(
      { username: process.env.ADMIN_USERNAME || "admin" },
      {
        password: hashedPassword,
        role: "admin",
        isApproved: true
      },
      { upsert: true, new: true }
    );

    console.log("✅ Admin password UPDATED successfully");

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

createOrUpdateAdmin();
