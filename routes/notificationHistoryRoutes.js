const express = require('express');
const router = express.Router();
const NotificationLog = require('../models/NotificationLog');
const jwt = require('jsonwebtoken');

const { verifyToken } = require('../middleware/authMiddleware');

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
