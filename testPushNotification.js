/**
 * Push Notification Test Script
 * Run this script to test FCM push notifications from command line
 * 
 * Usage: node testPushNotification.js
 */

const axios = require('axios');

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:5000';
const TOPIC = process.env.TOPIC || 'all';
const TITLE = process.env.TITLE || 'Test Notification';
const MESSAGE = process.env.MESSAGE || 'This is a test push notification from WattOrbit!';

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testPushNotification() {
    log('\n🔔 WattOrbit Push Notification Test', 'bright');
    log('=====================================\n', 'cyan');

    log(`📍 API URL: ${API_URL}`, 'blue');
    log(`📢 Topic: ${TOPIC}`, 'blue');
    log(`📝 Title: ${TITLE}`, 'blue');
    log(`💬 Message: ${MESSAGE}`, 'blue');
    log('');

    try {
        // Step 1: Check Firebase Status
        log('Step 1: Checking Firebase Admin status...', 'yellow');
        const statusResponse = await axios.get(`${API_URL}/api/test-notification/status`);

        if (statusResponse.data.firebaseInitialized) {
            log('✅ Firebase Admin is initialized and ready!', 'green');
        } else {
            log('❌ Firebase Admin is NOT initialized!', 'red');
            log('Please check your serviceAccountKey.json or FIREBASE_SERVICE_ACCOUNT env variable.', 'red');
            return;
        }

        log('');

        // Step 2: Send Test Notification
        log('Step 2: Sending test notification...', 'yellow');
        const notificationResponse = await axios.post(`${API_URL}/api/test-notification`, {
            topic: TOPIC,
            title: TITLE,
            message: MESSAGE
        });

        if (notificationResponse.data.success) {
            log('✅ Test notification sent successfully!', 'green');
            log('');
            log('Response Details:', 'cyan');
            log(`  Topic: ${notificationResponse.data.details.topic}`, 'blue');
            log(`  Title: ${notificationResponse.data.details.title}`, 'blue');
            log(`  Body: ${notificationResponse.data.details.body}`, 'blue');
            log(`  FCM Response: ${notificationResponse.data.details.fcmResponse}`, 'blue');
        } else {
            log('❌ Failed to send notification', 'red');
            log(`Error: ${notificationResponse.data.message}`, 'red');
        }

    } catch (error) {
        log('\n❌ Test Failed!', 'red');

        if (error.response) {
            log(`Status: ${error.response.status}`, 'red');
            log(`Message: ${error.response.data.message || error.response.statusText}`, 'red');
            if (error.response.data.error) {
                log(`Error Details: ${error.response.data.error}`, 'red');
            }
        } else if (error.request) {
            log('No response received from server', 'red');
            log('Make sure the backend server is running!', 'yellow');
        } else {
            log(`Error: ${error.message}`, 'red');
        }
    }

    log('\n=====================================\n', 'cyan');
}

// Run the test
testPushNotification();
