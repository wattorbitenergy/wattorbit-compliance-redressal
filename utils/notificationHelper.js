const admin = require('firebase-admin');
const User = require('../models/User');
const NotificationLog = require('../models/NotificationLog');

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

        // ✅ LOG TO DATABASE (Persistent History)
        await NotificationLog.create({
            userId: user._id,
            title,
            body,
            data,
            imageUrl: data.imageUrl || undefined
        });

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

        // ✅ LOG TO DATABASE (Persistent History for all users in topic)
        // If topic is 'all', 'admin', 'technician' etc., we find relevant users and log
        if (['all', 'admin', 'technician', 'engineer', 'organisation', 'employee'].includes(topic)) {
            const query = topic === 'all' ? {} : { role: topic };
            const users = await User.find(query).select('_id');
            const logs = users.map(u => ({
                userId: u._id,
                title,
                body,
                data,
                imageUrl: data.imageUrl || undefined
            }));
            if (logs.length > 0) {
                await NotificationLog.insertMany(logs);
            }
        }

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
