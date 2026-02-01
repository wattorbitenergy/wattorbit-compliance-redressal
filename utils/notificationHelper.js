const admin = require('firebase-admin');
const User = require('../models/User');

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

module.exports = {
    sendUserNotification
};
