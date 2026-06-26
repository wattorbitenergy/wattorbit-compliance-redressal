const express = require('express');
const router = express.Router();
const Promotion = require('../models/Promotion');
const jwt = require('jsonwebtoken');
const { cacheMiddleware, invalidateCache, CACHE_KEYS } = require('../middleware/cache');

// Verify token middleware
const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authorization header missing or invalid' });
    }

    const token = authHeader.split(' ')[1];
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
};

// Admin/Engineer check middleware
const isAuthorized = (req, res, next) => {
    if (req.user.role !== 'admin' && req.user.role !== 'engineer' && req.user.role !== 'employee') {
        return res.status(403).json({ message: 'Elevated access required' });
    }
    next();
};

// @desc    Get all active promotions (cached 5 min)
// @route   GET /api/promotions
// @access  Public
router.get('/', cacheMiddleware(CACHE_KEYS.PROMOTIONS, 300), async (req, res) => {
    try {
        const promotions = await Promotion.find({ isActive: true }).sort({ order: 1, createdAt: -1 });
        res.json(promotions);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc    Get all promotions (including inactive)
// @route   GET /api/promotions/admin
// @access  Private/Admin
router.get('/admin', verifyToken, isAuthorized, async (req, res) => {
    try {
        const promotions = await Promotion.find().sort({ order: 1, createdAt: -1 });
        res.json(promotions);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc    Create new promotion
// @route   POST /api/promotions
// @access  Private/Admin
router.post('/', verifyToken, isAuthorized, async (req, res) => {
    try {
        const promotion = new Promotion(req.body);
        const savedPromotion = await promotion.save();
        invalidateCache(CACHE_KEYS.PROMOTIONS);
        res.status(201).json(savedPromotion);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// @desc    Update promotion
// @route   PUT /api/promotions/:id
// @access  Private/Admin
router.put('/:id', verifyToken, isAuthorized, async (req, res) => {
    try {
        const promotion = await Promotion.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!promotion) return res.status(404).json({ message: 'Promotion not found' });
        invalidateCache(CACHE_KEYS.PROMOTIONS);
        res.json(promotion);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// @desc    Delete promotion
// @route   DELETE /api/promotions/:id
// @access  Private/Admin
router.delete('/:id', verifyToken, isAuthorized, async (req, res) => {
    try {
        const promotion = await Promotion.findByIdAndDelete(req.params.id);
        if (!promotion) return res.status(404).json({ message: 'Promotion not found' });
        invalidateCache(CACHE_KEYS.PROMOTIONS);
        res.json({ message: 'Promotion removed' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
