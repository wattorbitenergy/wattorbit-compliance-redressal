const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const User = require('./models/User');

async function createSpecializedStaff() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to DB');

        // Create a Plumber
        const plumber = new User({
            username: 'prakash_plumber',
            name: 'Prakash Sharma',
            email: 'prakash@example.com',
            phone: '9876543210',
            password: 'password123',
            role: 'technician',
            specialization: 'Plumber',
            isApproved: true
        });

        // Create a House Help
        const cleaner = new User({
            username: 'rekha_cleaning',
            name: 'Rekha Devi',
            email: 'rekha@example.com',
            phone: '9876543211',
            password: 'password123',
            role: 'technician',
            specialization: 'House Help',
            isApproved: true
        });

        await plumber.save();
        await cleaner.save();

        console.log('Successfully created specialized staff:');
        console.log('- Plumber: prakash_plumber');
        console.log('- House Help: rekha_cleaning');

        process.exit(0);
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
}

createSpecializedStaff();
