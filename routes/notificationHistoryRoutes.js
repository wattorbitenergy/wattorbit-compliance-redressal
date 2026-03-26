const express = require('express');
const router = express.Router();
const NotificationLog = require('../models/NotificationLog');
const jwt = require('jsonwebtoken');

// Verify Token Middleware
const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authorization header missing or invalid' });
    }
    const token = authHeader.split(' ')[1];
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
};

/**
 * GET: Fetch notification logs for current user
 */
router.get('/my-history', verifyToken, async (req, res) => {
    try {
        const logs = await NotificationLog.find({ userId: req.user.id })
            .sort({ createdAt: -1 })
            .limit(50);
        res.json(logs);
    } catch (err) {
        console.error('Fetch notification history error:', err);
        res.status(500).json({ message: 'Failed to fetch notification history' });
    }
});

/**
 * DELETE: Clear notification logs for current user
 */
router.delete('/my-history/clear', verifyToken, async (req, res) => {
    try {
        await NotificationLog.deleteMany({ userId: req.user.id });
        res.json({ message: 'Notification history cleared' });
    } catch (err) {
        res.status(500).json({ message: 'Failed to clear notification history' });
    }
});

module.exports = router;
