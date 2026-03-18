/**************************************************
 * enable_onboarding.js
 * Run: node backend/scripts/enable_onboarding.js
 **************************************************/
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const Config = require('../models/Config');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/wcrm_dev';

async function run() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB');

        await Config.findOneAndUpdate(
            { key: 'ff_onboarding' },
            { value: true },
            { upsert: true, new: true }
        );

        console.log('✅ Feature flag ff_onboarding ENABLED');
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

run();
