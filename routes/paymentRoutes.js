const express = require('express');
const router = express.Router();
const Payment = require('../models/Payment');
const Booking = require('../models/Booking');
const { generatePaymentId } = require('../utils/idGenerator');
const { triggerAutomation } = require('../utils/automationEngine');
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

// POST: Initiate payment for booking
router.post('/initiate', verifyToken, async (req, res) => {
    try {
        const { bookingId, paymentMethod } = req.body;

        if (!bookingId || !paymentMethod) {
            return res.status(400).json({
                message: 'Missing required fields: bookingId, paymentMethod'
            });
        }

        // Verify booking exists and belongs to user
        const booking = await Booking.findById(bookingId);
        if (!booking) {
            return res.status(404).json({ message: 'Booking not found' });
        }

        if (booking.userId.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Check if payment already exists for this booking
        const existingPayment = await Payment.findOne({ bookingId });
        if (existingPayment && existingPayment.status === 'Paid') {
            return res.status(400).json({ message: 'Payment already completed for this booking' });
        }

        const paymentId = await generatePaymentId();

        const payment = new Payment({
            paymentId,
            bookingId,
            userId: req.user.id,
            amount: booking.totalAmount,
            paymentMethod,
            status: 'Pending',
            paymentHistory: [{
                action: 'initiated',
                timestamp: new Date(),
                amount: booking.totalAmount,
                notes: `Payment initiated via ${paymentMethod}`
            }]
        });

        await payment.save();

        // Trigger automation hook
        await triggerAutomation('payment.initiated', payment);

        res.status(201).json({
            message: 'Payment initiated successfully',
            payment
        });
    } catch (err) {
        console.error('Error initiating payment:', err);
        res.status(500).json({ message: 'Failed to initiate payment' });
    }
});

// POST: Confirm payment (for online payments - webhook)
router.post('/confirm', async (req, res) => {
    try {
        const { paymentId, transactionId, gatewayResponse } = req.body;

        if (!paymentId) {
            return res.status(400).json({ message: 'Payment ID required' });
        }

        const payment = await Payment.findOne({ paymentId });

        if (!payment) {
            return res.status(404).json({ message: 'Payment not found' });
        }

        payment.status = 'Paid';
        payment.transactionId = transactionId;
        payment.gatewayResponse = gatewayResponse;
        payment.paymentHistory.push({
            action: 'paid',
            timestamp: new Date(),
            amount: payment.amount,
            notes: `Payment confirmed via ${payment.paymentMethod}`
        });

        await payment.save();

        // Trigger automation hook
        await triggerAutomation('payment.received', payment);

        res.json({ message: 'Payment confirmed successfully', payment });
    } catch (err) {
        console.error('Error confirming payment:', err);
        res.status(500).json({ message: 'Failed to confirm payment' });
    }
});

// PATCH: Mark COD as collected (technician only)
router.patch('/:id/cod-collect', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'technician') {
            return res.status(403).json({ message: 'Technician access required' });
        }

        const payment = await Payment.findById(req.params.id)
            .populate('bookingId');

        if (!payment) {
            return res.status(404).json({ message: 'Payment not found' });
        }

        // Verify technician is assigned to this booking
        if (!payment.bookingId.assignedTechnician ||
            payment.bookingId.assignedTechnician.toString() !== req.user.id) {
            return res.status(403).json({ message: 'You are not assigned to this booking' });
        }

        if (payment.paymentMethod !== 'COD') {
            return res.status(400).json({ message: 'This is not a COD payment' });
        }

        if (payment.status === 'Paid') {
            return res.status(400).json({ message: 'Payment already collected' });
        }

        payment.status = 'Paid';
        payment.codCollectedBy = req.user.id;
        payment.codCollectedAt = new Date();
        payment.paymentHistory.push({
            action: 'paid',
            timestamp: new Date(),
            amount: payment.amount,
            notes: 'COD collected by technician'
        });

        await payment.save();

        // Trigger automation hook
        await triggerAutomation('payment.received', payment);

        res.json({ message: 'COD payment collected successfully', payment });
    } catch (err) {
        console.error('Error collecting COD payment:', err);
        res.status(500).json({ message: 'Failed to collect COD payment' });
    }
});

// GET: Get payment details for booking
router.get('/booking/:bookingId', verifyToken, async (req, res) => {
    try {
        const payment = await Payment.findOne({ bookingId: req.params.bookingId })
            .populate('bookingId')
            .populate('userId', 'name phone email')
            .populate('codCollectedBy', 'name phone');

        if (!payment) {
            return res.status(404).json({ message: 'Payment not found' });
        }

        // Check access
        if (
            payment.userId._id.toString() !== req.user.id &&
            req.user.role !== 'admin' &&
            (!payment.bookingId.assignedTechnician ||
                payment.bookingId.assignedTechnician.toString() !== req.user.id)
        ) {
            return res.status(403).json({ message: 'Access denied' });
        }

        res.json(payment);
    } catch (err) {
        console.error('Error fetching payment:', err);
        res.status(500).json({ message: 'Failed to fetch payment' });
    }
});

// POST: Process refund (admin only)
router.post('/:id/refund', verifyToken, isAdmin, async (req, res) => {
    try {
        const { refundAmount, refundReason } = req.body;

        if (!refundAmount || !refundReason) {
            return res.status(400).json({
                message: 'Missing required fields: refundAmount, refundReason'
            });
        }

        const payment = await Payment.findById(req.params.id);

        if (!payment) {
            return res.status(404).json({ message: 'Payment not found' });
        }

        if (payment.status !== 'Paid') {
            return res.status(400).json({ message: 'Can only refund paid payments' });
        }

        if (refundAmount > payment.amount) {
            return res.status(400).json({ message: 'Refund amount cannot exceed payment amount' });
        }

        payment.status = 'Refunded';
        payment.refundAmount = refundAmount;
        payment.refundReason = refundReason;
        payment.refundedAt = new Date();
        payment.paymentHistory.push({
            action: 'refunded',
            timestamp: new Date(),
            amount: refundAmount,
            notes: refundReason
        });

        await payment.save();

        res.json({ message: 'Refund processed successfully', payment });
    } catch (err) {
        console.error('Error processing refund:', err);
        res.status(500).json({ message: 'Failed to process refund' });
    }
});

module.exports = router;
