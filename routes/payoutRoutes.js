const express = require('express');
const router = express.Router();
const Payout = require('../models/Payout');
const User = require('../models/User');
const FinancialLedger = require('../models/FinancialLedger');
const { verifyToken } = require('../middleware/authMiddleware');

// Middleware to check if user is admin
const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Access denied. Admin only.' });
    }
    next();
};

/**
 * GET: Fetch technicians with positive wallet balance (Pending Payouts)
 */
router.get('/pending', verifyToken, isAdmin, async (req, res) => {
    try {
        const techs = await User.find({ 
            role: 'technician', 
            walletBalance: { $gt: 0 } 
        }).select('name phone walletBalance upiId');
        res.json(techs);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching pending payouts' });
    }
});

/**
 * POST: Record a manual payout
 */
router.post('/record', verifyToken, isAdmin, async (req, res) => {
    const { technicianId, amount, transactionRef, notes } = req.body;

    try {
        const tech = await User.findById(technicianId);
        if (!tech) return res.status(404).json({ message: 'Technician not found' });

        if (!tech.upiId) {
            return res.status(400).json({ message: 'Technician does not have a UPI ID set' });
        }

        // Generate Payout ID
        const payoutCount = await Payout.countDocuments();
        const payoutId = `PAY-${new Date().getFullYear()}-${String(payoutCount + 1).padStart(4, '0')}`;

        // Deduct from wallet
        tech.walletBalance -= amount;
        await tech.save();

        // Create Payout record
        const payout = await Payout.create({
            payoutId,
            technicianId,
            amount,
            upiId: tech.upiId,
            transactionRef,
            status: 'Completed',
            notes,
            initiatedBy: req.user.id
        });

        // Create Ledger entry
        await FinancialLedger.create({
            userId: technicianId,
            type: 'PAYOUT',
            amount: -amount,
            description: `Payout recorded by Admin. Ref: ${transactionRef || 'N/A'}`,
            balanceAfter: tech.walletBalance,
            referenceId: payoutId,
            isDemo: false
        });

        res.json({ message: 'Payout recorded successfully', payout });
    } catch (err) {
        console.error('Payout record error:', err);
        res.status(500).json({ message: 'Failed to record payout' });
    }
});

/**
 * GET: Payout history for a technician
 */
router.get('/history/:id', verifyToken, async (req, res) => {
    try {
        // Only admin or the tech themselves can see history
        if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
            return res.status(403).json({ message: 'Unauthorized' });
        }

        const payouts = await Payout.find({ technicianId: req.params.id }).sort({ createdAt: -1 });
        res.json(payouts);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching payout history' });
    }
});

module.exports = router;
