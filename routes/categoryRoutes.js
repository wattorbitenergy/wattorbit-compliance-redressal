const express = require('express');
const router = express.Router();
const Category = require('../models/Category');
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

// Admin check middleware
const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
    }
    next();
};

/* =====================
   PUBLIC ENDPOINTS
===================== */

// GET: List all active categories
router.get('/', async (req, res) => {
    try {
        const categories = await Category.find({ isActive: true }).sort({ order: 1, name: 1 });
        res.json(categories);
    } catch (err) {
        console.error('Error fetching categories:', err);
        res.status(500).json({ message: 'Failed to fetch categories' });
    }
});

/* =====================
   ADMIN ENDPOINTS
===================== */

// GET: List all categories (including inactive)
router.get('/admin/all', verifyToken, isAdmin, async (req, res) => {
    try {
        const categories = await Category.find().sort({ order: 1, name: 1 });
        res.json(categories);
    } catch (err) {
        console.error('Error fetching all categories:', err);
        res.status(500).json({ message: 'Failed to fetch categories' });
    }
});

// POST: Create new category
router.post('/', verifyToken, isAdmin, async (req, res) => {
    try {
        const category = new Category(req.body);
        await category.save();
        res.status(201).json({ message: 'Category created successfully', category });
    } catch (err) {
        console.error('Error creating category:', err);
        res.status(400).json({ message: err.message });
    }
});

// PUT: Update category
router.put('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const category = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
        if (!category) return res.status(404).json({ message: 'Category not found' });
        res.json({ message: 'Category updated successfully', category });
    } catch (err) {
        console.error('Error updating category:', err);
        res.status(400).json({ message: err.message });
    }
});

// DELETE: Delete category
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const category = await Category.findByIdAndDelete(req.params.id);
        if (!category) return res.status(404).json({ message: 'Category not found' });
        res.json({ message: 'Category deleted successfully' });
    } catch (err) {
        console.error('Error deleting category:', err);
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
