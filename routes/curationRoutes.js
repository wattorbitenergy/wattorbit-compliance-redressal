const express = require('express');
const router = express.Router();
const Curation = require('../models/Curation');
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

// Admin/Engineer/Employee check
const isAuthorized = (req, res, next) => {
    if (!['admin', 'engineer', 'employee'].includes(req.user.role)) {
        return res.status(403).json({ message: 'Elevated access required' });
    }
    next();
};

// GET /api/curations — public, active only, sorted by order
router.get('/', async (req, res) => {
    try {
        const curations = await Curation.find({ isActive: true })
            .sort({ order: 1, createdAt: -1 });
        res.json(curations);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// GET /api/curations/admin — all curations (including inactive)
router.get('/admin', verifyToken, isAuthorized, async (req, res) => {
    try {
        const curations = await Curation.find()
            .populate('targetServiceId', 'name')
            .populate('targetPackageId', 'name')
            .sort({ order: 1, createdAt: -1 });
        res.json(curations);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// POST /api/curations — create
router.post('/', verifyToken, isAuthorized, async (req, res) => {
    try {
        const curation = new Curation(req.body);
        const saved = await curation.save();
        res.status(201).json(saved);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// PUT /api/curations/:id — update
router.put('/:id', verifyToken, isAuthorized, async (req, res) => {
    try {
        const curation = await Curation.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!curation) return res.status(404).json({ message: 'Curation not found' });
        res.json(curation);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// DELETE /api/curations/:id
router.delete('/:id', verifyToken, isAuthorized, async (req, res) => {
    try {
        const curation = await Curation.findByIdAndDelete(req.params.id);
        if (!curation) return res.status(404).json({ message: 'Curation not found' });
        res.json({ message: 'Curation deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
