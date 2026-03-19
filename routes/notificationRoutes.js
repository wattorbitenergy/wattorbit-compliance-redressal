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
        // Firebase Admin init
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

router.post('/subscribe', verifyToken, async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: 'Token required' });

    try {
        const subscriptions = [];

        // 1. General Broadcast
        subscriptions.push(admin.messaging().subscribeToTopic(token, 'all'));

        // 2. Role-specific Topic
        if (req.user.role) {
            subscriptions.push(admin.messaging().subscribeToTopic(token, req.user.role));
        }

        // 3. User-specific Personal Topic (Phone)
        if (req.user.phone) {
            const phoneTopic = `user_${req.user.phone.replace(/\D/g, "")}`;
            subscriptions.push(admin.messaging().subscribeToTopic(token, phoneTopic));
        }

        // 4. Technician-specific Topic (Username)
        if (req.user.role === 'technician' && req.user.username) {
            const techTopic = `tech_${req.user.username}`;
            subscriptions.push(admin.messaging().subscribeToTopic(token, techTopic));
        }

        // Wait for all subscriptions (using allSettled as some might fail if topic names are invalid, though unlikely)
        await Promise.allSettled(subscriptions);

        res.status(200).json({ message: 'Device subscribed to all relevant topics successfully' });
    } catch (err) {
        console.error('Unified Subscription Error:', err);
        res.status(500).json({ message: 'Unified subscription failed' });
    }
});

/* POST: Send Push Notification (FCM) */
router.post('/', verifyToken, async (req, res) => {
    const allowedRoles = ['admin', 'employee'];
    if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ message: 'Administrative access required' });
    }

    const { title, message, targetRole, targetServiceId, targetPackageId, link, imageUrl } = req.body;

    if (!admin.apps.length) {
        return res.status(503).json({ message: 'Firebase not configured on server' });
    }

    try {
        const topic = targetRole || 'all';

        const payload = {
            notification: {
                title: title,
                body: message,
                ...(imageUrl && { image: imageUrl })
            },
            data: {
                targetServiceId: targetServiceId || "",
                targetPackageId: targetPackageId || "",
                link: link || "",
                imageUrl: imageUrl || ""
            },
            topic: topic
        };

        // Send to FCM
        const response = await admin.messaging().send(payload);
        // Message sent successfully

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
