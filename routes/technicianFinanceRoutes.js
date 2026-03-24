const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const FinancialLedger = require('../models/FinancialLedger');
const TechnicianEarning = require('../models/TechnicianEarning');
const TechnicianPayout = require('../models/TechnicianPayout');
const Booking = require('../models/Booking');
const User = require('../models/User');
const mongoose = require('mongoose');
const { updateUniversalLedger } = require('../utils/technicianFinanceHelper');

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
 * GET: Get current user balance and summary (Universal)
 */
router.get('/balance', verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        const stats = {
            balance: user.walletBalance || 0
        };

        if (user.role === 'technician') {
            const totalEarned = await TechnicianEarning.aggregate([
                { $match: { technicianId: new mongoose.Types.ObjectId(req.user.id), status: 'credited' } },
                { $group: { _id: null, total: { $sum: '$technicianShare' } } }
            ]);
            const totalPaid = await TechnicianPayout.aggregate([
                { $match: { technicianId: new mongoose.Types.ObjectId(req.user.id), status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]);
            stats.totalEarned = totalEarned[0]?.total || 0;
            stats.totalPaid = totalPaid[0]?.total || 0;
        }

        res.json(stats);
    } catch (err) {
        console.error('Balance fetch error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

/**
 * GET: Get user ledger (Universal History)
 */
router.get('/ledger/:userId', verifyToken, async (req, res) => {
    try {
        const targetUserId = req.params.userId;
        
        // Security check: only admins can see others, users see their own
        if (targetUserId !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'employee') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const ledger = await FinancialLedger.find({ userId: targetUserId })
            .sort({ createdAt: -1 })
            .limit(100);

        res.json(ledger);
    } catch (err) {
        console.error('Ledger fetch error:', err);
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
            discounts: (booking.discount || 0) + (booking.lineItemDiscount || 0) + (booking.pointsUsed || 0),
            technician: booking.assignedTechnician,
            earningStatus: earning ? earning.status : 'Not Calculated',
            earningRecord: earning
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

/**
 * POST: Record a Payout/Disbursement (Admin Only)
 */
router.post('/admin/disburse', verifyToken, isAdmin, async (req, res) => {
  try {
    const { userId, amount, method, transactionId, notes } = req.body;

    if (!userId || !amount || !transactionId) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // 1. Record specific role record if needed (TechnicianPayout for techs)
    // This maintains backward compatibility with the old Payout model for now
    if (user.role === 'technician') {
        await TechnicianPayout.create({
            technicianId: userId,
            amount,
            payoutMethod: method || 'UPI',
            transactionId,
            notes,
            processedBy: req.user.id,
            status: 'completed'
        });
    }

    // 2. Update Universal Ledger and User Balance
    await updateUniversalLedger(
        userId,
        'PAYOUT',
        amount,
        transactionId,
        `Disbursement of ₹${amount} via ${method || 'UPI'}. Ref: ${transactionId}`,
        { method, transactionId, notes, processedBy: req.user.id }
    );

    res.status(201).json({ message: 'Disbursement recorded successfully' });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: 'Duplicate Transaction ID' });
    console.error('Disbursement error:', err);
    res.status(500).json({ message: 'Failed to record disbursement' });
  }
});

const RedemptionRequest = require('../models/RedemptionRequest');
const { sendUserNotification } = require('../utils/notificationHelper');
const Razorpay = require('razorpay');

// Initialize Razorpay (requires RazorpayX credentials for fund account validation)
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

/**
 * POST: Verify UPI ID via Razorpay
 */
router.post('/verify-upi', verifyToken, async (req, res) => {
    try {
        const { upiId } = req.body;
        
        // 1. Basic Regex Validation
        const upiRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
        if (!upiId || !upiRegex.test(upiId)) {
            return res.status(400).json({ message: 'Invalid UPI ID format' });
        }

        try {
            // 2. Razorpay Fund Account Validation (Penny Drop)
            // Note: This requires RazorpayX or Fund Account Validation to be enabled on the merchant account.
            
            // Using razorpay-node SDK or direct API call.
            // Since SDK support for fundAccount.validate might vary, we'll try the standard SDK approach
            // If the user's account isn't enabled for this, Razorpay will throw an error, which we catch.

            // The following uses Razorpay's direct node-sdk wrapper if available, 
            // or we use standard fetch if SDK fails. We'll use the SDK format here.
            /* 
            const validationResponse = await razorpay.fundAccount.validate({
                account_number: process.env.RAZORPAYX_ACCOUNT_NUMBER || "YOUR_CUSTOMER_IDENTIFIER",
                fund_account: {
                    account_type: "vpa",
                    vpa: { address: upiId }
                },
                amount: 100, // INR 1 to verify
                currency: "INR"
            });
            */
            
            // For safety with potentially older razorpay sdk versions, we use native fetch against razorpay API
            const encodedAuth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
            
            const verifyCall = await fetch('https://api.razorpay.com/v1/fund_accounts/validations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${encodedAuth}`
                },
                body: JSON.stringify({
                    account_number: process.env.RAZORPAYX_ACCOUNT_NUMBER || process.env.RAZORPAY_KEY_ID, // fallback
                    fund_account: {
                        account_type: "vpa",
                        vpa: { address: upiId }
                    },
                    amount: 100,
                    currency: "INR",
                    notes: {
                        userId: req.user.id,
                        reason: "Wallet Redemption UPI Verification"
                    }
                })
            });

            const razorpayData = await verifyCall.json();

            if (!verifyCall.ok) {
                // If API is not enabled for the account, it throws standard errors.
                console.warn('Razorpay UPI Verification Warning:', razorpayData);
                return res.status(400).json({ 
                    message: razorpayData.error?.description || 'UPI Verification failed or is not enabled on your Razorpay dashboard.' 
                });
            }

            // Success validation response returns status 'created' or 'completed'
            // The verified name usually appears in `results.registered_name`
            const registeredName = razorpayData.results?.registered_name || "Verified VPA Owner";
            
            res.json({ 
                success: true, 
                message: 'UPI ID Verified Successfully', 
                verifiedName: registeredName,
                validationId: razorpayData.id
            });

        } catch (apiErr) {
            console.error('Razorpay API Error:', apiErr);
            res.status(500).json({ message: 'Error communicating with Razorpay Verification API' });
        }

    } catch (err) {
        console.error('Verify UPI Error:', err);
        res.status(500).json({ message: 'Internal server error during verification' });
    }
});

/**
 * POST: Request Redemption (Universal for any role with balance)
 */
router.post('/request-redemption', verifyToken, async (req, res) => {
    try {
        const { amount, upiId } = req.body;
        if (!amount || amount <= 0 || !upiId) {
            return res.status(400).json({ message: 'Amount and UPI ID are required' });
        }

        const user = await User.findById(req.user.id);
        if (!user || user.walletBalance < amount) {
            return res.status(400).json({ message: 'Insufficient balance' });
        }

        // Check for existing pending request to avoid spam
        const pending = await RedemptionRequest.findOne({ userId: req.user.id, status: 'pending' });
        if (pending) {
            return res.status(400).json({ message: 'You already have a pending redemption request' });
        }

        const request = await RedemptionRequest.create({
            userId: req.user.id,
            amount,
            upiId,
            status: 'pending'
        });

        res.status(201).json({ message: 'Redemption request submitted successfully', request });
    } catch (err) {
        console.error('Redemption request error:', err);
        res.status(500).json({ message: 'Failed to submit request' });
    }
});

/**
 * GET: Admin view redemption requests
 */
router.get('/admin/redemption-requests', verifyToken, isAdmin, async (req, res) => {
    try {
        const { status } = req.query;
        const query = status ? { status } : {};
        const requests = await RedemptionRequest.find(query)
            .populate('userId', 'name username phone role')
            .sort({ createdAt: -1 });
        res.json(requests);
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch requests' });
    }
});

/**
 * PATCH: Admin process redemption request
 */
router.patch('/admin/process-redemption/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const { status, transactionId, adminNotes } = req.body;
        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ message: 'Invalid status' });
        }

        const request = await RedemptionRequest.findById(req.params.id);
        if (!request) return res.status(404).json({ message: 'Request not found' });
        if (request.status !== 'pending') {
            return res.status(400).json({ message: 'Request already processed' });
        }

        if (status === 'approved') {
            if (!transactionId) return res.status(400).json({ message: 'Transaction ID required for approval' });

            // 1. Process Financial Transaction
            await updateUniversalLedger(
                request.userId,
                'PAYOUT',
                request.amount,
                transactionId,
                `Wallet Redemption (UPI: ${request.upiId})`,
                { redemptionRequestId: request._id, transactionId, method: 'UPI' }
            );

            request.status = 'approved';
            request.transactionId = transactionId;
        } else {
            request.status = 'rejected';
        }

        request.adminNotes = adminNotes;
        request.processedAt = new Date();
        request.processedBy = req.user.id;
        await request.save();

        // 🔔 Notify User
        sendUserNotification(
            request.userId,
            `Redemption ${status.toUpperCase()}`,
            status === 'approved' 
                ? `Your request for ₹${request.amount} has been processed. Trans ID: ${transactionId}`
                : `Your redemption request was rejected. Notes: ${adminNotes || 'N/A'}`,
            { type: 'redemption', status }
        ).catch(e => console.error('Notify redemption error:', e));

        res.json({ message: `Request ${status} successfully`, request });
    } catch (err) {
        console.error('Process redemption error:', err);
        res.status(500).json({ message: 'Failed to process request' });
    }
});

/**
 * GET: Admin GST Liability
 * Calculates GST based on net platform earnings for completed/confirmed bookings
 */
router.get('/admin/finance/gst-liability', verifyToken, isAdmin, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        let query = {
            status: { $in: ['Completed', 'Confirmed', 'Assigned', 'In Progress'] } // Bookings that generate liability
        };

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        const bookings = await Booking.find(query)
            .populate('assignedTechnician', 'name phone')
            .sort({ createdAt: -1 })
            .lean();

        let totalGrossPlatformFees = 0;
        let totalPlatformDiscountShare = 0;
        let totalNetPlatformEarnings = 0;
        let totalGstLiability = 0;

        const liabilityData = bookings.map(b => {
            const grossPlatformFee = b.platformFees || 0;
            const platformDiscountShare = b.platformDiscountShare || 0;
            const netPlatformFee = Math.max(0, grossPlatformFee - platformDiscountShare);
            const gst = b.taxes || 0; // The already calculated GST stored on the booking (18% of net)

            totalGrossPlatformFees += grossPlatformFee;
            totalPlatformDiscountShare += platformDiscountShare;
            totalNetPlatformEarnings += netPlatformFee;
            totalGstLiability += gst;

            return {
                bookingId: b.bookingId || b._id,
                date: b.createdAt,
                status: b.status,
                technician: b.assignedTechnician ? b.assignedTechnician.name : 'Unassigned',
                basePrice: b.basePrice || 0,
                grossPlatformFee,
                platformDiscountShare,
                netPlatformFee,
                gstLiability: gst
            };
        });

        res.json({
            summary: {
                totalBookings: liabilityData.length,
                totalGrossPlatformFees,
                totalPlatformDiscountShare,
                totalNetPlatformEarnings,
                totalGstLiability
            },
            data: liabilityData
        });
    } catch (err) {
        console.error('Error fetching GST liability:', err);
        res.status(500).json({ message: 'Failed to fetch GST liability' });
    }
});

module.exports = router;
