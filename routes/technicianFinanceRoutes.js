const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const FinancialLedger = require('../models/FinancialLedger');
const TechnicianEarning = require('../models/TechnicianEarning');
const TechnicianPayout = require('../models/TechnicianPayout');
const Booking = require('../models/Booking');
const User = require('../models/User');
const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const { updateUniversalLedger } = require('../utils/technicianFinanceHelper');
const auditLogger = require('../utils/auditLogger');
const { round } = require('../utils/mathUtils');
const { jsonToCsv } = require('../utils/csvUtils');

router.use(auditLogger);

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
        let targetId = req.user.id;
        if (req.query.techId && (req.user.role === 'admin' || req.user.role === 'engineer')) {
            targetId = req.query.techId;
        }

        const user = await User.findById(targetId);
        if (!user) return res.status(404).json({ message: 'User not found' });

        const stats = {
            balance: user.walletBalance || 0
        };

        if (user.role === 'technician') {
            const totalEarned = await TechnicianEarning.aggregate([
                { $match: { technicianId: new mongoose.Types.ObjectId(targetId), status: 'credited' } },
                { $group: { _id: null, total: { $sum: '$technicianShare' } } }
            ]);
            const totalPaid = await TechnicianPayout.aggregate([
                { $match: { technicianId: new mongoose.Types.ObjectId(targetId), status: 'completed' } },
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
            platformDiscountShare: booking.platformDiscountShare || 0,
            technicianDiscountShare: booking.technicianDiscountShare || 0,
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
 * Calculates GST based on Invoices (Output Tax) minus Material Purchase Taxes (Input Tax Credit)
 */
router.get('/admin/finance/gst-liability', verifyToken, isAdmin, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        let query = {};

        if (startDate || endDate) {
            query.invoiceDate = {};
            if (startDate) query.invoiceDate.$gte = new Date(startDate);
            if (endDate) query.invoiceDate.$lte = new Date(endDate);
        }

        // 1. Get all Invoices in period
        const invoices = await Invoice.find(query)
            .populate({
                path: 'bookingId',
                select: 'bookingId materialsUsed status'
            })
            .sort({ invoiceDate: -1 })
            .lean();

        let totalOutputTax = 0;
        let totalInputTax = 0; // ITC
        let totalTaxableValue = 0;

        const liabilityData = invoices.map(inv => {
            const outputTax = round(inv.taxAmount || 0);
            const taxableValue = round(inv.subtotal || 0);
            
            // Calculate ITC from linked booking materials
            let itemITC = 0;
            if (inv.bookingId && inv.bookingId.materialsUsed) {
                inv.bookingId.materialsUsed.forEach(m => {
                    // ITC is the tax paid during purchase
                    itemITC += round((m.purchaseTaxAmount || 0) * (m.quantity || 1));
                });
            }

            totalOutputTax += outputTax;
            totalInputTax += itemITC;
            totalTaxableValue += taxableValue;

            return {
                invoiceId: inv.invoiceId,
                date: inv.invoiceDate,
                customer: inv.customerName,
                taxableValue,
                outputTax,
                inputTaxCredit: round(itemITC),
                netLiability: round(outputTax - itemITC),
                cgst: round(inv.totalCGST || 0),
                sgst: round(inv.totalSGST || 0),
                igst: round(inv.totalIGST || 0)
            };
        });

        res.json({
            summary: {
                totalInvoices: invoices.length,
                totalTaxableValue: round(totalTaxableValue),
                totalOutputTax: round(totalOutputTax),
                totalInputTaxCredit: round(totalInputTax),
                netGstLiability: round(totalOutputTax - totalInputTax)
            },
            data: liabilityData
        });
    } catch (err) {
        console.error('Error fetching GST liability:', err);
        res.status(500).json({ message: 'Failed to fetch GST liability' });
    }
});

/**
 * GET: Export Ledger as CSV
 */
router.get('/admin/finance/ledger/export', verifyToken, isAdmin, async (req, res) => {
    try {
        const { startDate, endDate, userId } = req.query;
        let query = {};
        
        if (userId) query.userId = userId;
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        const entries = await FinancialLedger.find(query)
            .populate('userId', 'name role phone')
            .sort({ createdAt: -1 })
            .lean();

        if (entries.length === 0) {
            return res.status(404).json({ message: 'No entries found for export' });
        }

        // Flatten data for CSV
        const csvData = entries.map(e => ({
            Date: new Date(e.createdAt).toLocaleString(),
            UserName: e.userId?.name || 'N/A',
            Role: e.userId?.role || 'N/A',
            Type: e.type,
            Amount: e.amount,
            BalanceAfter: e.balanceAfter,
            Description: e.description,
            ReferenceID: e.referenceId || 'N/A'
        }));

        const csv = jsonToCsv(csvData);
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=ledger-export-${new Date().getTime()}.csv`);
        res.status(200).send(csv);
    } catch (err) {
        console.error('Ledger export error:', err);
        res.status(500).json({ message: 'Failed to export ledger' });
    }
});

/**
 * GET: Admin Master Ledger (System-wide Trial of Money)
 */
router.get('/admin/master-ledger', verifyToken, isAdmin, async (req, res) => {
    try {
        const { limit = 100, skip = 0, type } = req.query;
        const query = type ? { type } : {};

        const ledger = await FinancialLedger.find(query)
            .populate('userId', 'name phone role')
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .skip(parseInt(skip));

        const totalEntries = await FinancialLedger.countDocuments(query);

        res.json({
            ledger,
            pagination: {
                total: totalEntries,
                limit: parseInt(limit),
                skip: parseInt(skip)
            }
        });
    } catch (err) {
        console.error('Master ledger fetch error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

/**
 * GET: Get specific transaction details (Metadata Receipt)
 */
router.get('/transaction/:id', verifyToken, async (req, res) => {
    try {
        const entry = await FinancialLedger.findById(req.params.id)
            .populate('userId', 'name phone role');
        
        if (!entry) return res.status(404).json({ message: 'Transaction not found' });

        // Security: Admins see all, others only their own
        if (req.user.role !== 'admin' && req.user.role !== 'employee' && entry.userId._id.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Access denied' });
        }

        res.json(entry);
    } catch (err) {
        console.error('Transaction fetch error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
