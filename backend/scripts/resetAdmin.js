require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function resetAdmin() {
  await mongoose.connect(process.env.MONGO_URI);

  const admin = await User.findOne({ username: 'admin' });

  if (!admin) {
    console.log('Admin not found');
    process.exit(0);
  }

  admin.password = 'Admin@123';
  await admin.save();

  console.log('Admin password reset successfully');
  process.exit(0);
}

resetAdmin();
