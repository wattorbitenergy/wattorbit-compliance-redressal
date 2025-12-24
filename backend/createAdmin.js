const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/wattorbit_redressal';

async function createAdmin() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB');

        const existingAdmin = await User.findOne({ username: process.env.ADMIN_USERNAME || 'admin' });
        if (existingAdmin) {
            console.log('Admin user already exists');
        } else {
            const admin = new User({
                username: process.env.ADMIN_USERNAME || 'admin',
                password: process.env.ADMIN_PASSWORD, // Pulled from .env and hashed by hook
                role: 'admin',
                isApproved: true
            });
            await admin.save();
            console.log('Admin user created successfully using environment variables.');
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await mongoose.disconnect();
    }
}

createAdmin();
