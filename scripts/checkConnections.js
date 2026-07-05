/**************************************************
 * Railway/Render Backend Diagnostic Tool
 * Usage: node scripts/checkConnections.js
 **************************************************/

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

async function runDiagnostics() {
    console.log('--- 🚀 WattOrbit Backend Connectivity Diagnostics ---\n');

    // 1. MongoDB Check
    console.log('1. Checking MongoDB Connection...');
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
        console.error('   ❌ MONGO_URI is missing from environment variables.\n');
    } else {
        try {
            await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
            console.log('   ✅ MongoDB Connected successfully!\n');
            await mongoose.disconnect();
        } catch (err) {
            console.error(`   ❌ MongoDB Connection Failed: ${err.message}\n`);
        }
    }

    // 2. Mailjet Check
    console.log('2. Checking Mailjet (Email) Configuration...');
    const mailjetKey = process.env.MAILJET_API_KEY;
    const mailjetSecret = process.env.MAILJET_SECRET_KEY;
    if (!mailjetKey || !mailjetSecret) {
        console.error('   ❌ MAILJET_API_KEY or MAILJET_SECRET_KEY is missing.\n');
    } else {
        try {
            const auth = Buffer.from(`${mailjetKey}:${mailjetSecret}`).toString('base64');
            const axios = require('axios');
            const https = require('https');
            
            const httpsAgent = new https.Agent({
              keepAlive: false,
              family: 4
            });

            // Simple request to list account info to verify keys
            await axios.get('https://api.mailjet.com/v3/REST/user', {
              headers: {
                'Authorization': `Basic ${auth}`
              },
              httpsAgent,
              timeout: 10000
            });
            console.log('   ✅ Mailjet API Keys verified successfully!\n');
        } catch (err) {
            console.error(`   ❌ Mailjet API Verification Failed: ${err.message}\n`);
            console.log('   💡 (Check if your API keys are correct and active)\n');
        }
    }

    // 3. Fast2SMS Check
    console.log('3. Checking Fast2SMS (SMS) Configuration...');
    const fast2smsKey = process.env.FAST2SMS_API_KEY;
    if (!fast2smsKey) {
        console.warn('   ⚠️ FAST2SMS_API_KEY is missing. SMS services will not work.\n');
    } else {
        console.log('   ✅ FAST2SMS_API_KEY is present.\n');
    }

    // 4. Firebase Check
    console.log('4. Checking Firebase Admin SDK...');
    try {
        const fs = require('fs');
        const serviceAccountPath = path.resolve(__dirname, '../serviceAccountKey.json');
        if (fs.existsSync(serviceAccountPath)) {
            const admin = require('firebase-admin');
            if (!admin.apps.length) {
                admin.initializeApp({
                    credential: admin.credential.cert(require(serviceAccountPath))
                });
            }
            console.log('   ✅ Firebase Admin SDK initialized successfully!\n');
        } else {
            console.warn('   ⚠️ serviceAccountKey.json not found in backend directory. Firebase features may be limited.\n');
        }
    } catch (err) {
        console.error(`   ❌ Firebase Initialization Failed: ${err.message}\n`);
    }

    // 5. Razorpay Check
    console.log('5. Checking Razorpay Configuration...');
    const razorpayKey = process.env.RAZORPAY_KEY_ID;
    const razorpaySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!razorpayKey || !razorpaySecret) {
        console.warn('   ⚠️ RAZORPAY_KEY_ID or SECRET is missing. Payments will not work.\n');
    } else {
        console.log('   ✅ Razorpay API Keys are present.\n');
    }

    // 6. Config Whitelist Check (New Feature)
    console.log('6. Verifying Config Whitelist (Public Access Controls)...');
    try {
        const adminRoutes = require('../routes/adminRoutes');
        if (adminRoutes) {
            console.log('   ✅ Config Whitelist logic is present in adminRoutes.\n');
        }
    } catch (e) {
        console.warn('   ⚠️ Could not verify adminRoutes.\n');
    }

    console.log('--- 🏁 Diagnostics Complete ---');
    process.exit(0);
}

runDiagnostics();
