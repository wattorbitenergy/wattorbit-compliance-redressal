const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

/**
 * TEST ENDPOINT: Send a test push notification
 * No authentication required for testing purposes
 * Usage: POST /api/test-notification
 * Body: { topic: 'all', title: 'Test', message: 'Hello World' }
 */
router.post('/', async (req, res) => {
    try {
        // Check if Firebase Admin is initialized
        if (!admin.apps.length) {
            return res.status(503).json({
                success: false,
                message: 'Firebase Admin not initialized. Check serviceAccountKey.json or FIREBASE_SERVICE_ACCOUNT env variable.'
            });
        }

        const { topic = 'all', title = 'Test Notification', message = 'This is a test push notification from WattOrbit!' } = req.body;

        // Prepare the FCM message
        const payload = {
            notification: {
                title: title,
                body: message
            },
            topic: topic
        };

        // Send notification via FCM
        const response = await admin.messaging().send(payload);

        console.log('✅ Test notification sent successfully:', response);

        res.status(200).json({
            success: true,
            message: 'Test notification sent successfully!',
            details: {
                topic: topic,
                title: title,
                body: message,
                fcmResponse: response
            }
        });

    } catch (error) {
        console.error('❌ Test notification failed:', error);

        res.status(500).json({
            success: false,
            message: 'Failed to send test notification',
            error: error.message,
            errorCode: error.code
        });
    }
});

/**
 * GET: Check Firebase Admin Status
 */
router.get('/status', (req, res) => {
    const isInitialized = admin.apps.length > 0;

    res.json({
        firebaseInitialized: isInitialized,
        message: isInitialized
            ? 'Firebase Admin is ready to send notifications'
            : 'Firebase Admin not initialized'
    });
});

module.exports = router;
