const mongoose = require('mongoose');
const User = require('./models/User');
const Complaint = require('./models/Complaint');
const Counter = require('./models/Counter');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error('Error: MONGO_URI is not defined in .env');
    process.exit(1);
}

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
    console.error('Error: ADMIN_PASSWORD is not defined in .env');
    process.exit(1);
}

async function startFresh() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB');

        // 1. Clear all collections
        console.log('Clearing existing data...');
        await Complaint.deleteMany({});
        await Counter.deleteMany({});
        await User.deleteMany({});
        console.log('Database cleared.');

        // 2. Create high-security Admin user
        const admin = new User({
            username: ADMIN_USERNAME,
            password: ADMIN_PASSWORD,
            role: 'admin',
            isApproved: true
        });

        await admin.save();
        console.log(`Fresh start complete. Admin created with username: ${ADMIN_USERNAME}`);
        console.log('Password has been pulled from your .env file and hashed in the database.');

    } catch (err) {
        console.error('Error during database reset:', err);
    } finally {
        await mongoose.disconnect();
    }
}

startFresh();
