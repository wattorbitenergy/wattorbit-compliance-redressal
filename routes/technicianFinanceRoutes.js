const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const TechnicianEarning = require('../models/TechnicianEarning');
const TechnicianPayout = require('../models/TechnicianPayout');
const TechnicianLedger = require('../models/TechnicianLedger');
const Booking = require('../models/Booking');
const User = require('../models/User');
const mongoose = require('mongoose');
const { updateTechnicianLedger } = require('../utils/technicianFinanceHelper');

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
    if (req.user.role !== 'admin' && req.user.role !== 'employee') {
        return res.status(403).json({ message: 'Administrative access required' });
    }
    next();
};

/**
 * GET: Get current technician balance and summary
 */
router.get('/technician/balance', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'technician') {
            return res.status(403).json({ message: 'Technician access only' });
        }

        const lastEntry = await TechnicianLedger.findOne({ technicianId: req.user.id }).sort({ createdAt: -1 });
        const balance = lastEntry ? lastEntry.runningBalance : 0;

        // Stats
        const totalEarned = await TechnicianEarning.aggregate([
            { $match: { technicianId: new mongoose.Types.ObjectId(req.user.id), status: 'credited' } },
            { $group: { _id: null, total: { $sum: '$technicianShare' } } }
        ]);

        const totalPaid = await TechnicianPayout.aggregate([
            { $match: { technicianId: new mongoose.Types.ObjectId(req.user.id), status: 'completed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        res.json({
            balance,
            totalEarned: totalEarned[0]?.total || 0,
            totalPaid: totalPaid[0]?.total || 0
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

/**
 * GET: Get technician ledger (History)
 */
router.get('/technician/ledger', verifyToken, async (req, res) => {
    try {
        let techId = req.user.id;
        
        // Admins can query by technicianId
        if (req.query.technicianId && (req.user.role === 'admin' || req.user.role === 'employee')) {
            techId = req.query.technicianId;
        } else if (req.user.role !== 'technician') {
            return res.status(403).json({ message: 'Unauthorized' });
        }

        const ledger = await TechnicianLedger.find({ technicianId: techId })
            .sort({ createdAt: -1 })
            .limit(50);

        res.json(ledger);
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

/**
 * GET: Financial breakdown of a booking (Admin Only)
 */
router.get('/booking-breakdown/:bookingId', verifyToken, isAdmin, async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.bookingId)
            .populate('assignedTechnician', 'name phone');
        
        if (!booking) return res.status(404).json({ message: 'Booking not found' });

        const earning = await TechnicianEarning.findOne({ bookingId: booking._id });

        res.json({
            bookingId: booking.bookingId,
            customerPaid: booking.totalAmount,
            technicianShare: booking.technicianCharges,
            platformFee: booking.platformFees,
            taxes: booking.taxes,
            discounts: booking.discount + (booking.lineItemDiscount || 0) + (booking.pointsUsed || 0),
            technician: booking.assignedTechnician,
            earningStatus: earning ? earning.status : 'Not Calculated',
            earningRecord: earning
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

/**
 * POST: Record a Payout (Admin Only)
 */
router.post('/admin/payout', verifyToken, isAdmin, async (req, res) => {
    try {
        const { technicianId, amount, method, transactionId, notes } = req.body;

        if (!technicianId || !amount || !transactionId) {
            return res.status(400).json({ message: 'Missing fields: technicianId, amount, transactionId' });
        }

        // 1. Create Payout Record
        const payout = await TechnicianPayout.create({
            technicianId,
            amount,
            payoutMethod: method || 'UPI',
            transactionId,
            notes,
            processedBy: req.user.id,
            status: 'completed'
        });

        // 2. Update Ledger
        await updateTechnicianLedger(
            technicianId,
            'payout',
            amount,
            payout._id,
            `Payout of ₹${amount} processed via ${method || 'UPI'}`,
            { transactionId }
        );

        res.status(201).json({ message: 'Payout recorded successfully', payout });
    } catch (err) {
        if (err.code === 11000) return res.status(400).json({ message: 'Duplicate Transaction ID' });
        console.error('Payout error:', err);
        res.status(500).json({ message: 'Failed to record payout' });
    }
});

module.exports = router;
