const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');

// NOTE: User must set up Firebase Admin SDK
// Put serviceAccountKey.json in backend root or use ENV variables
try {
    if (!admin.apps.length) {
        // Check for Service Account in Env or File
        const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
            ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
            : require('../serviceAccountKey.json'); // Fallback to file

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("Firebase Admin Initialized");
    }
} catch (e) {
    console.warn("Firebase Init Failed: Ensure serviceAccountKey.json exists or FIREBASE_SERVICE_ACCOUNT env is set.", e.message);
}

/* MIDDLEWARE */
const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'No token' });

    const token = authHeader.split(' ')[1];
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ message: 'Invalid token' });
    }
};

/* POST: Subscribe to Topic */
router.post('/subscribe', async (req, res) => {
    const { token, role } = req.body;
    if (!token) return res.status(400).json({ message: 'Token required' });

    try {
        // Subscribe to 'all' for broadcasts
        await admin.messaging().subscribeToTopic(token, 'all');

        // Subscribe to role-specific topic (if role exists)
        if (role) {
            await admin.messaging().subscribeToTopic(token, role);
        }

        res.status(200).json({ message: 'Subscribed to topics' });
    } catch (err) {
        console.error('Topic Subscription Error:', err);
        res.status(500).json({ message: 'Subscription failed' });
    }
});

/* POST: Send Push Notification (FCM) */
router.post('/', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
    }

    const { title, message, targetRole } = req.body;

    if (!admin.apps.length) {
        return res.status(503).json({ message: 'Firebase not configured on server' });
    }

    try {
        // Topic strategy: 'all', 'user', 'technician', etc.
        const topic = targetRole || 'all';

        const payload = {
            notification: {
                title: title,
                body: message
            },
            topic: topic
        };

        // Send to FCM
        const response = await admin.messaging().send(payload);
        console.log('Successfully sent message:', response);

        // No database storage as per request
        res.status(200).json({ message: 'Notification sent via FCM', fcmResponse: response });

    } catch (err) {
        console.error('FCM Send Error:', err);
        res.status(500).json({ message: 'Failed to send notification via FCM', error: err.message });
    }
});

/* GET: Fetch Notifications (Disabled) */
router.get('/', verifyToken, (req, res) => {
    // Storage is disabled to reduce load
    res.json([]);
});

module.exports = router;
