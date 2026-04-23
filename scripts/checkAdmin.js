const mongoose = require("mongoose");
const User = require("../models/User");
require("dotenv").config();

async function checkAdminDetails() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const admin = await User.findOne({ role: "admin" }).select("+password");
    if (!admin) {
      console.log("❌ No admin found!");
    } else {
      console.log("✅ Admin Found:");
      console.log(`- Email: ${admin.email}`);
      console.log(`- Phone: ${admin.phone}`);
      console.log(`- Has Password: ${!!admin.password}`);
      console.log(`- Is Approved: ${admin.isApproved}`);
    }
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

checkAdminDetails();
