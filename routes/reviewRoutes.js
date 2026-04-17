const express = require('express');
const router = express.Router();
const Review = require('../models/Review');
const jwt = require('jsonwebtoken');

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

const requireAdmin = (req, res, next) => {
    if (req.user && (req.user.role === 'admin' || req.user.role === 'employee')) {
        next();
    } else {
        return res.status(403).json({ message: 'Administrative access required' });
    }
};

// ===============================
// PUBLIC ROUTES
// ===============================

// GET global featured reviews (useful for homepage/SEO)
router.get('/featured', async (req, res) => {
    try {
        const reviews = await Review.find({ isFeatured: true })
            .populate('serviceCategory', 'name')
            .sort({ createdAt: -1 })
            .limit(10);
        res.json(reviews);
    } catch (err) {
        console.error('Error fetching reviews:', err);
        res.status(500).json({ message: 'Failed to fetch reviews' });
    }
});

// ===============================
// ADMIN ROUTES
// ===============================

// GET all reviews
router.get('/admin/all', verifyToken, requireAdmin, async (req, res) => {
    try {
        const reviews = await Review.find().populate('serviceCategory', 'name').sort({ createdAt: -1 });
        res.json(reviews);
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch reviews' });
    }
});

// POST a new review manually (Admin curating reviews from Google/elsewhere for SEO)
router.post('/', verifyToken, requireAdmin, async (req, res) => {
    try {
        const review = new Review(req.body);
        const savedReview = await review.save();
        res.status(201).json(savedReview);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// PUT update a review
router.put('/:id', verifyToken, requireAdmin, async (req, res) => {
    try {
        const updatedReview = await Review.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!updatedReview) return res.status(404).json({ message: 'Review not found' });
        res.json(updatedReview);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// DELETE a review
router.delete('/:id', verifyToken, requireAdmin, async (req, res) => {
    try {
        const deletedReview = await Review.findByIdAndDelete(req.params.id);
        if (!deletedReview) return res.status(404).json({ message: 'Review not found' });
        res.json({ message: 'Review deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
