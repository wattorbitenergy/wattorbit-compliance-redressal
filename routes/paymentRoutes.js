const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Booking = require('../models/Booking');
const Config = require('../models/Config');
const { generateBookingId } = require('../utils/idGenerator');
const { sendUserNotification, sendTopicNotification } = require('../utils/notificationHelper');

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

// Initialize Razorpay
// Note: These should be in the .env file
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'your_key_id',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'your_key_secret'
});

// POST: Create Razorpay Order
router.post('/create-order', verifyToken, async (req, res) => {
    try {
        const { bookingId } = req.body;
        if (!bookingId) {
            return res.status(400).json({ message: 'Booking ID is required' });
        }

        const booking = await Booking.findById(bookingId);
        if (!booking) {
            return res.status(404).json({ message: 'Booking not found' });
        }

        // Check if online payment is enabled in settings
        const onlinePaymentEnabled = await Config.findOne({ key: 'enable_online_payment' });
        if (onlinePaymentEnabled && onlinePaymentEnabled.value === false) {
            return res.status(400).json({ message: 'Online payment is currently disabled' });
        }

        const options = {
            amount: Math.round(booking.totalAmount * 100), // Razorpay amount is in paise
            currency: 'INR',
            receipt: booking.bookingId,
            notes: {
                bookingId: booking._id.toString(),
                userId: req.user.id
            }
        };

        const order = await razorpay.orders.create(options);

        // Update booking with razorpayOrderId
        booking.razorpayOrderId = order.id;
        booking.paymentMethod = 'Online';
        await booking.save();

        res.json({
            orderId: order.id,
            amount: options.amount,
            currency: options.currency,
            key_id: process.env.RAZORPAY_KEY_ID
        });
    } catch (err) {
        console.error('Razorpay Order Creation Error:', err);
        res.status(500).json({ message: 'Failed to create payment order' });
    }
});

// POST: Verify Razorpay Signature
router.post('/verify-payment', verifyToken, async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            bookingId
        } = req.body;

        const body = razorpay_order_id + "|" + razorpay_payment_id;

        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'your_key_secret')
            .update(body.toString())
            .digest('hex');

        const isSignatureValid = expectedSignature === razorpay_signature;

        if (isSignatureValid) {
            const booking = await Booking.findById(bookingId);
            if (!booking) {
                return res.status(404).json({ message: 'Booking not found' });
            }

            booking.paymentReceived = true;
            booking.razorpayPaymentId = razorpay_payment_id;
            booking.razorpaySignature = razorpay_signature;
            booking.status = 'Confirmed'; // Auto confirm if payment is received

            // Generate Booking ID if missing (for Online Payments)
            if (!booking.bookingId) {
                booking.bookingId = await generateBookingId();
            }

            booking.statusHistory.push({
                status: 'Confirmed',
                timestamp: new Date(),
                updatedBy: req.user.id,
                notes: `Online payment received (ID: ${razorpay_payment_id}). Booking confirmed and ID ${booking.bookingId} generated.`
            });

            await booking.save();

            // Notify Admin of confirmed online booking
            await sendTopicNotification(
                'admin',
                'Online Payment Confirmed',
                `Payment confirmed for booking ${booking.bookingId}. Status updated to Confirmed.`,
                { bookingId: booking._id.toString(), type: 'payment_confirmed' }
            );

            res.json({ message: 'Payment verified successfully', booking });
        } else {
            res.status(400).json({ message: 'Invalid payment signature' });
        }
    } catch (err) {
        console.error('Razorpay Signature Verification Error:', err);
        res.status(500).json({ message: 'Failed to verify payment' });
    }
});

module.exports = router;
