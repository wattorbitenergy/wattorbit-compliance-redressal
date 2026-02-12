const admin = require('firebase-admin');
const User = require('../models/User');

// Initialize Firebase Admin if not already initialized
try {
    if (!admin.apps.length) {
        const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
            ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
            : require('../serviceAccountKey.json');

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("Firebase Admin Initialized in Helper");
    }
} catch (e) {
    console.warn("Firebase Init Failed in Helper: Ensure serviceAccountKey.json exists or FIREBASE_SERVICE_ACCOUNT env is set.", e.message);
}

/**
 * Send a direct push notification to a user via their FCM token
 */
async function sendUserNotification(userId, title, body, data = {}) {
    try {
        const user = await User.findById(userId);
        if (!user || !user.fcmToken) {
            console.log(`Notification skipped: No FCM token for user ${userId}`);
            return false;
        }

        const message = {
            notification: {
                title,
                body
            },
            data: {
                ...data,
                click_action: 'FLUTTER_NOTIFICATION_CLICK' // For mobile compatibility
            },
            token: user.fcmToken
        };

        const response = await admin.messaging().send(message);
        console.log(`Successfully sent notification to ${user.name || user.username}:`, response);
        return true;
    } catch (err) {
        console.error('Error sending user notification:', err);
        return false;
    }
}

/**
 * Send a notification to a topic (e.g., 'admin', 'technician', 'all')
 */
async function sendTopicNotification(topic, title, body, data = {}) {
    try {
        const message = {
            notification: {
                title,
                body
            },
            data: {
                ...data,
                click_action: 'FLUTTER_NOTIFICATION_CLICK'
            },
            topic: topic
        };

        const response = await admin.messaging().send(message);
        console.log(`Successfully sent notification to topic '${topic}':`, response);
        return true;
    } catch (err) {
        console.error(`Error sending notification to topic '${topic}':`, err);
        return false;
    }
}

module.exports = {
    sendUserNotification,
    sendTopicNotification
};
