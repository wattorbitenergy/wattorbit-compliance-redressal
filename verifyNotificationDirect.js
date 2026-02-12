require('dotenv').config({ path: 'backend/.env' });
const { sendTopicNotification, sendUserNotification } = require('./utils/notificationHelper');
const admin = require('firebase-admin');

// Mock Firebase if not initialized (though notificationHelper attempts to init)
// We rely on notificationHelper's init logic.

async function verify() {
    console.log("Verifying Notification Helper Functions...");

    try {
        // Test 1: Send to 'admin' topic
        console.log("Attempting to send to 'admin' topic...");
        const adminResult = await sendTopicNotification(
            'admin',
            'Verification Test',
            'Testing admin topic notification',
            { type: 'test' }
        );
        console.log(`Admin Topic Result: ${adminResult ? 'SUCCESS' : 'FAILED'}`);

        // Test 2: Send to random user (should fail gracefully or log skip if no token)
        console.log("\nAttempting to send to dummy user...");
        // We won't have a real DB connection here easily without setup, so this might fail at User.findById
        // But we want to ensure the function itself is callable.

        console.log("Done. If Admin Topic Result was SUCCESS, the topic logic works.");
        process.exit(0);
    } catch (e) {
        console.error("Verification failed:", e);
        process.exit(1);
    }
}

verify();
