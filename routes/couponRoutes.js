const express = require('express');
const router = express.Router();
const Coupon = require('../models/Coupon');
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
   ADMIN ENDPOINTS
   ===================== */

// GET: Get all coupons
router.get('/', verifyToken, isAdmin, async (req, res) => {
    try {
        const coupons = await Coupon.find().sort({ createdAt: -1 });
        res.json(coupons);
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch coupons' });
    }
});

// POST: Create coupon
router.post('/', verifyToken, isAdmin, async (req, res) => {
    try {
        const coupon = new Coupon(req.body);
        await coupon.save();
        res.status(201).json(coupon);
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ message: 'Coupon code already exists' });
        }
        res.status(500).json({ message: 'Failed to create coupon' });
    }
});

// PATCH: Update coupon
router.patch('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!coupon) return res.status(404).json({ message: 'Coupon not found' });
        res.json(coupon);
    } catch (err) {
        res.status(500).json({ message: 'Failed to update coupon' });
    }
});

// DELETE: Delete coupon
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const coupon = await Coupon.findByIdAndDelete(req.params.id);
        if (!coupon) return res.status(404).json({ message: 'Coupon not found' });
        res.json({ message: 'Coupon deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Failed to delete coupon' });
    }
});

/* =====================
   USER ENDPOINTS
   ===================== */

// POST: Validate coupon
router.post('/validate', verifyToken, async (req, res) => {
    try {
        const { code, amount, cartAmount, deliveryAmount } = req.body;
        const fallbackAmount = cartAmount !== undefined ? cartAmount : amount;
        
        if (!code || fallbackAmount === undefined) {
            return res.status(400).json({ message: 'Code and amount are required' });
        }

        const coupon = await Coupon.findOne({ code: code.toUpperCase() });
        if (!coupon) {
            return res.status(404).json({ message: 'Invalid coupon code' });
        }

        let targetAmount = fallbackAmount;
        if (coupon.applicableOn === 'delivery') {
            targetAmount = deliveryAmount || 0;
            if (targetAmount <= 0) {
                return res.status(400).json({ message: 'Delivery is already free or no delivery charge to discount' });
            }
        }

        if (!coupon.isValid(targetAmount)) {
            let reason = 'Coupon is invalid';
            const now = new Date();
            if (!coupon.isActive) reason = 'Coupon is inactive';
            else if (coupon.expiryDate < now) reason = 'Coupon has expired';
            else if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) reason = 'Coupon has expired';
            else if (targetAmount < coupon.minOrderAmount) reason = `Minimum order amount of ₹${coupon.minOrderAmount} required`;

            return res.status(400).json({ message: reason });
        }

        const discountAmount = coupon.calculateDiscount(targetAmount);
        res.json({
            message: 'Coupon applied successfully',
            discountAmount,
            applicableOn: coupon.applicableOn || 'cart',
            couponId: coupon._id,
            code: coupon.code
        });
    } catch (err) {
        res.status(500).json({ message: 'Failed to validate coupon' });
    }
});

module.exports = router;
