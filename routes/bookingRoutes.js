const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Service = require('../models/Service');
const ServicePackage = require('../models/ServicePackage');
const Address = require('../models/Address');
const User = require('../models/User');
const Coupon = require('../models/Coupon');
const Config = require('../models/Config');
const TechnicianEarning = require('../models/TechnicianEarning');
const FinancialLedger = require('../models/FinancialLedger');
const Invoice = require('../models/Invoice');
const { generateBookingId } = require('../utils/idGenerator');
const { triggerAutomation } = require('../utils/automationEngine');
const { sendUserNotification, sendTopicNotification } = require('../utils/notificationHelper');
const { autoGenerateInvoice } = require('../utils/invoiceHelper');
const { 
    sendBookingCreatedSms, 
    sendTechnicianAssignedSms, 
    sendJobAssignedToTechnicianSms, 
    sendServiceCompletedSms,
    sendServiceRequestOTPSms,
    sendBookingCancelledSms // 🆕
} = require('../utils/smsHelper'); 
const cache = require('../utils/cache');
const { 
    sendBookingCreatedEmail, 
    sendTechnicianAssignedEmail, 
    sendJobCompletedEmail,
    sendServiceRequestOTPEmail,
    sendBookingCancelledEmail // 🆕
} = require('../utils/emailHelper');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { uploadToCloudinary } = require('../utils/cloudinaryHelper');
const { recordTechnicianEarning } = require('../utils/technicianFinanceHelper');

// Configure Multer for temp storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads/temp';
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `job-${Date.now()}-${file.originalname}`);
    }
});
const upload = multer({ 
    storage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

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

// Admin, Engineer, or Partner (Organisation) check middleware
const canManageBookings = (req, res, next) => {
    const roles = ['admin', 'engineer', 'organisation', 'employee'];
    if (!roles.includes(req.user.role)) {
        return res.status(403).json({ message: 'Access denied: Requires Admin, Engineer, or Partner role' });
    }
    next();
};

// Admin or Engineer check middleware
const isAdminOrEngineer = (req, res, next) => {
    const roles = ['admin', 'engineer', 'employee'];
    if (!roles.includes(req.user.role)) {
        return res.status(403).json({ message: 'Administrative access required' });
    }
    next();
};

/* =====================
   USER ENDPOINTS
===================== */

// POST: Create new booking
router.post('/', verifyToken, async (req, res) => {
    try {
        const {
            serviceId,
            packageId,
            addressId,
            scheduledDate,
            scheduledTimeSlot,
            customerNotes,
            couponCode,
            paymentMethod
        } = req.body;

        // Validation
        if (!serviceId || !packageId || !addressId || !scheduledDate || !scheduledTimeSlot) {
            return res.status(400).json({
                message: 'Missing required fields: serviceId, packageId, addressId, scheduledDate, scheduledTimeSlot'
            });
        }

        // Verify service exists and is active
        const service = await Service.findById(serviceId);
        if (!service || !service.isActive) {
            return res.status(404).json({ message: 'Service not found or inactive' });
        }

        // Verify package exists and is active
        const servicePackage = await ServicePackage.findById(packageId);
        if (!servicePackage || !servicePackage.isActive) {
            return res.status(404).json({ message: 'Package not found or inactive' });
        }

        // Verify package belongs to service
        if (servicePackage.serviceId.toString() !== serviceId) {
            return res.status(400).json({ message: 'Package does not belong to selected service' });
        }

        // Verify address belongs to user
        const address = await Address.findById(addressId);
        if (!address || address.userId.toString() !== req.user.id) {
            return res.status(404).json({ message: 'Address not found or does not belong to user' });
        }

        // Fetch user to verify wallet and get organisationId
        const user = await User.findById(req.user.id);
        const organisationId = user?.organisationId || null;
        let pointsToUse = 0;

        // Check wallet balance
        const pointsInBody = req.body.pointsToUse || req.body.pointsUsed;
        if (pointsInBody && pointsInBody > 0) {
            const requestedPoints = Number(pointsInBody);
            if (user.walletBalance < requestedPoints) {
                return res.status(400).json({ message: 'Insufficient WattOrbit Cash Points' });
            }
            pointsToUse = requestedPoints;
        }

        // Calculate pricing
        let technicianCharges = servicePackage.technicianCharges || 0;
        let platformFees = servicePackage.platformFees || 0;
        
        // Calculate Dynamic Charges
        const appliedDynamicCharges = [];

        if (servicePackage.dynamicCharges && servicePackage.dynamicCharges.length > 0) {
            servicePackage.dynamicCharges.forEach(charge => {
                if (charge.isActive) {
                    appliedDynamicCharges.push({
                        name: charge.name,
                        amount: charge.amount,
                        recipient: charge.recipient || 'Platform'
                    });
                    
                    if (charge.recipient === 'Technician') {
                        technicianCharges += charge.amount;
                    } else {
                        platformFees += charge.amount;
                    }
                }
            });
        }

        // Base price for discounts is the total of components
        const basePrice = technicianCharges + platformFees;

        // Apply coupon if provided
        let discount = 0;
        let couponId = null;
        let technicianAbsorbsPercent = null;

        if (couponCode) {
            const coupon = await Coupon.findOne({ code: couponCode.toUpperCase() });
            if (!coupon) {
                return res.status(404).json({ message: 'Invalid coupon code' });
            }
            if (!coupon.isActive || coupon.expiryDate < new Date()) {
                return res.status(400).json({ message: 'Coupon has expired' });
            }
            if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
                return res.status(400).json({ message: 'Coupon usage limit reached' });
            }
            if (!coupon.isValid(basePrice)) {
                return res.status(400).json({ message: 'Coupon is not applicable for this order amount' });
            }

            discount = coupon.calculateDiscount(basePrice);
            couponId = coupon._id;
            technicianAbsorbsPercent = coupon.technicianAbsorbsPercent;
        }

        // Apply package discount if no coupon discount (or as fallback)
        // Note: Deciding that coupons take precedence and are not additive by default unless specified
        if (discount === 0 && servicePackage.discount && servicePackage.discount.percentage > 0) {
            if (!servicePackage.discount.validUntil || new Date(servicePackage.discount.validUntil) >= new Date()) {
                discount = Math.round((basePrice * servicePackage.discount.percentage) / 100);
            }
        }

        // --- Calculate Apportionment ---
        let technicianDiscountShare = 0;
        let platformDiscountShare = 0;

        if (discount > 0) {
            if (technicianAbsorbsPercent !== null && technicianAbsorbsPercent !== undefined) {
                technicianDiscountShare = Math.round(discount * (technicianAbsorbsPercent / 100));
            } else {
                if (basePrice > 0) {
                    technicianDiscountShare = Math.round(discount * (technicianCharges / basePrice));
                }
            }
            platformDiscountShare = discount - technicianDiscountShare;
        }

        const netPlatformFees = platformFees - platformDiscountShare;

        const taxRate = 18; // 18% GST on platform fees only
        const taxes = Math.max(0, Math.round((netPlatformFees * taxRate) / 100));

        const totalAmount = Math.max(0, basePrice + taxes - discount - pointsToUse);

        // For Online payments: defer bookingId generation until payment is verified.
        // For COD/Wallet: generate bookingId immediately.
        const isOnlinePayment = paymentMethod === 'Online';
        const bookingId = isOnlinePayment ? undefined : await generateBookingId();

        // 🆕 AUTO-ASSIGNMENT LOGIC via Notes (Controlled by Feature Flag)
        let autoAssignedTech = null;
        try {
            const autoAssignFlag = await Config.findOne({ key: 'ff_auto_assign_by_note' });
            if (autoAssignFlag && autoAssignFlag.value === true && customerNotes) {
                // Extract 10-digit phone number
                const phoneMatch = customerNotes.match(/\b\d{10}\b/);
                if (phoneMatch) {
                    const extractedPhone = phoneMatch[0];
                    const technician = await User.findOne({ 
                        role: 'technician', 
                        phone: extractedPhone 
                    });

                    if (technician) {
                        autoAssignedTech = technician;
                    }
                }
            }
        } catch (e) {
            console.error('[Auto-Assign] Error checking flag/user:', e);
        }

        const isAssigned = !!autoAssignedTech;
        const bookingStatus = isAssigned ? 'Assigned' : 'Pending';

        const booking = new Booking({
            bookingId,
            userId: req.user.id,
            organisationId, // Capture Org context
            serviceId,
            packageId,
            services: [{
                serviceId,
                packageId,
                name: `${service.name} (${servicePackage.name})`,
                basePrice: servicePackage.basePrice || service.basePrice,
                technicianCharges: servicePackage.technicianCharges || 0,
                platformFees: servicePackage.platformFees || 0,
                discount: discount, // Initial discount (coupon/package)
                finalPrice: totalAmount, // Initial final price logic preserved
                isAdditional: false
            }],
            addressId,
            scheduledDate: new Date(scheduledDate),
            scheduledTimeSlot,
            customerNotes,
            basePrice,
            technicianCharges,
            platformFees,
            taxes,
            couponId,
            couponCode: couponCode ? couponCode.toUpperCase() : undefined,
            discount,
            technicianDiscountShare,
            platformDiscountShare,
            appliedDynamicCharges,
            pointsUsed: pointsToUse,
            totalAmount,
            paymentMethod: paymentMethod || 'COD',
            assignedTechnician: isAssigned ? autoAssignedTech._id : undefined,
            assignedAt: isAssigned ? new Date() : undefined,
            status: bookingStatus,
            statusHistory: [{
                status: bookingStatus,
                timestamp: new Date(),
                updatedBy: req.user.id,
                notes: isAssigned 
                    ? `Auto-assigned to ${autoAssignedTech.name} via booking notes`
                    : (isOnlinePayment ? 'Booking initiated (Awaiting Payment)' : 'Booking created')
            }]
        });

        await booking.save();
        cache.del('dashboard_stats:role=admin&org=global'); // Simple bust for now

        // Track coupon usage
        if (couponId) {
            await Coupon.findByIdAndUpdate(couponId, { $inc: { usedCount: 1 } });
        }

        // Deduct points from wallet and update default payment method
        if (pointsToUse > 0) {
            user.walletBalance -= pointsToUse;
        }
        if (paymentMethod && ['COD', 'Online', 'Wallet'].includes(paymentMethod)) {
            user.defaultPaymentMethod = paymentMethod;
        }
        await user.save();

        // Trigger automation hook
        await triggerAutomation('booking.created', booking);

        // For Online payments: NO notifications until payment is verified (handled in paymentRoutes.js).
        // For COD/Wallet: send notifications immediately.
        if (!isOnlinePayment) {
            // Notify Admin of new booking (push)
            await sendTopicNotification(
                'admin',
                'New Booking Received',
                `New booking ${booking.bookingId} for ${service.name}.`,
                { bookingId: booking._id.toString(), type: 'new_booking' }
            );

            // SMS: Booking Created — to Customer
            sendBookingCreatedSms(req.user.id, user.name || 'Customer', booking.bookingId, service.name).catch(e => console.error('[SMS] booking created error:', e));

            // 🔥 Email: Booking Created — to Customer
            sendBookingCreatedEmail(user, booking, service.name).catch(e => console.error('[Email] booking created error:', e));

            // 🆕 Auto-assignment notifications if applicable
            if (isAssigned) {
                // Trigger automation hook for assignment
                triggerAutomation('booking.assigned', booking).catch(e => console.error('[Auto-Assign] Automation error:', e));

                // Notify Technician (push)
                sendUserNotification(
                    autoAssignedTech._id,
                    'New Service Assignment (Auto)',
                    `You have been automatically assigned to booking ${booking.bookingId} via customer request.`,
                    { bookingId: booking._id.toString(), type: 'assignment' }
                ).catch(e => console.error('[Auto-Assign] Tech notification error:', e));

                // Notify User (push)
                sendUserNotification(
                    booking.userId,
                    'Technician Assigned',
                    `Technician ${autoAssignedTech.name} has been assigned to your booking ${booking.bookingId}.`,
                    { bookingId: booking._id.toString(), type: 'assignment' }
                ).catch(e => console.error('[Auto-Assign] User notification error:', e));

                // SMS: Technician Assigned — to Customer
                sendTechnicianAssignedSms(
                    booking.userId,
                    user.name || 'Customer',
                    booking.bookingId,
                    autoAssignedTech.name
                ).catch(e => console.error('[Auto-Assign] SMS customer error:', e));

                // Email: Technician Assigned — to Customer
                sendTechnicianAssignedEmail(user, autoAssignedTech, booking).catch(e => console.error('[Auto-Assign] Email customer error:', e));

                // SMS: Job Assigned — to Technician
                sendJobAssignedToTechnicianSms(
                    autoAssignedTech._id,
                    autoAssignedTech.name,
                    booking.bookingId
                ).catch(e => console.error('[Auto-Assign] SMS tech error:', e));
            }
        }

        // Populate for response
        await booking.populate([
            { path: 'serviceId', select: 'name category' },
            { path: 'packageId', select: 'name price' },
            { path: 'addressId' }
        ]);

        res.status(201).json({
            message: 'Booking created successfully',
            booking
        });
    } catch (err) {
        console.error('Error creating booking:', err);
        res.status(500).json({ message: 'Failed to create booking' });
    }
});

// GET: Get user's booking history
router.get('/my-bookings', verifyToken, async (req, res) => {
    try {
        const { status } = req.query;
        const { role, id } = req.user;

        let query = {};

        if (role === 'organisation') {
            // Organisation users see all bookings belonging to their organisation
            query.organisationId = id;
        } else {
            // Individual users see only their own bookings
            query.userId = id;
        }

        if (status) {
            query.status = status;
        }

        const bookings = await Booking.find(query)
            .populate('serviceId', 'name category images')
            .populate('packageId', 'name price')
            .populate('addressId')
            .populate('assignedTechnician', 'name phone')
            .sort({ createdAt: -1 })
            .lean();

        // 🛡️ SECURITY: Hide technician photos from customers
        if (role === 'user' || role === 'organisation') {
            bookings.forEach(b => delete b.jobPhotos);
        }

        res.json(bookings);
    } catch (err) {
        console.error('Error fetching user bookings:', err);
        res.status(500).json({ message: 'Failed to fetch bookings' });
    }
});

// GET: Track booking (Public endpoint)
router.get('/track', async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) {
            return res.status(400).json({ message: 'Query parameter required' });
        }

        // 🛡️ SECURITY FIX: Only allow search by exact bookingId for public access.
        // Regex-based phone number search is disabled to prevent data leakage via partial matches.
        const bookings = await Booking.find({ bookingId: query })
            .populate('serviceId', 'name category')
            .populate('addressId', 'city street pincode')
            .populate('assignedTechnician', 'name phone')
            .sort({ createdAt: -1 })
            .lean();

        res.json(bookings);
    } catch (err) {
        console.error('Track booking error:', err);
        res.status(500).json({ message: 'Failed to track booking' });
    }
});

// GET: Get booking details
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        let query = {};

        // If it looks like a MongoDB ObjectId, check both _id and bookingId
        // Otherwise, check only bookingId
        if (id.match(/^[0-9a-fA-F]{24}$/)) {
            query = { $or: [{ _id: id }, { bookingId: id }] };
        } else {
            query = { bookingId: id };
        }

        const booking = await Booking.findOne(query)
            .populate('userId', 'name phone email')
            .populate('serviceId', 'name category description images')
            .populate('packageId', 'name price features')
            .populate('addressId')
            .populate('assignedTechnician', 'name phone email')
            .populate('organisationId', 'name phone email username');

        if (!booking) {
            return res.status(404).json({ message: 'Booking not found' });
        }

        // Check access: user can see their own, admin can see all, technician can see assigned, org see theirs, engineer sees scoped
        const isOwner = booking.userId._id.toString() === req.user.id;
        const isAdminUser = ['admin', 'employee'].includes(req.user.role);
        const isAssignedTech = booking.assignedTechnician && booking.assignedTechnician._id.toString() === req.user.id;
        const isOrgAdmin = req.user.role === 'organisation' && booking.organisationId?.toString() === req.user.id;

        // Engineer Logic: Global see individual, Org see Org
        let isSupervisor = false;
        if (req.user.role === 'engineer') {
            if (req.user.organisationId) {
                isSupervisor = booking.organisationId?.toString() === req.user.organisationId;
            } else {
                isSupervisor = !booking.organisationId; // null or undefined
            }
        }

        if (!isOwner && !isAdminUser && !isAssignedTech && !isOrgAdmin && !isSupervisor) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // 🛡️ SECURITY: Hide technician photos from customers
        if (req.user.role === 'user' || req.user.role === 'organisation') {
            const bookingObj = booking.toObject();
            delete bookingObj.jobPhotos;
            return res.json(bookingObj);
        }

        res.json(booking);
    } catch (err) {
        console.error('Error fetching booking details:', err);
        res.status(500).json({ message: 'Failed to fetch booking details' });
    }
});

// PATCH: Cancel booking
router.patch('/:id/cancel', verifyToken, async (req, res) => {
    try {
        const { cancellationReason } = req.body;

        const booking = await Booking.findById(req.params.id);

        if (!booking) {
            return res.status(404).json({ message: 'Booking not found' });
        }

        // Check if user owns the booking or is admin/engineer
        const isOwner = booking.userId.toString() === req.user.id;
        const isAdmin = req.user.role === 'admin';
        const isEngineer = req.user.role === 'engineer';

        if (!isOwner && !isAdmin && !isEngineer) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Check if booking can be cancelled
        if (['Completed', 'Cancelled'].includes(booking.status)) {
            return res.status(400).json({ message: 'Cannot cancel completed or already cancelled booking' });
        }

        // Cancellation Policy: Allow users and engineers to cancel without 1-hour block.
        // We removed the block based on the requirements.

        booking.status = 'Cancelled';
        booking.cancellationReason = cancellationReason;
        booking.statusHistory.push({
            status: 'Cancelled',
            timestamp: new Date(),
            updatedBy: req.user.id,
            notes: cancellationReason
        });

        await booking.save();
        cache.del('dashboard_stats:role=admin&org=global');

        // 💰 REFUND LOGIC: Refund used wallet points and actual money paid.
        let totalRefundToWallet = 0;
        let refundNotes = [];

        // 1. Refund Cash Points used during booking creation
        if (booking.pointsUsed && booking.pointsUsed > 0) {
            totalRefundToWallet += booking.pointsUsed;
            refundNotes.push(`Refund of ${booking.pointsUsed} Cash Points.`);
        }

        // 2. Refund ACTUAL money paid (only if payment was successful)
        // If paymentMethod is Wallet/Online and it was Paid (paymentReceived: true)
        if (['Online', 'Wallet', 'Mixed'].includes(booking.paymentMethod) && booking.paymentReceived && booking.totalAmount > 0) {
            totalRefundToWallet += booking.totalAmount;
            refundNotes.push(`Refund of ₹${booking.totalAmount} for cancelled paid booking.`);
        }

        if (totalRefundToWallet > 0) {
            const user = await User.findById(booking.userId);
            if (user) {
                user.walletBalance = (user.walletBalance || 0) + totalRefundToWallet;
                await user.save();
                
                // 📜 Record in Universal Financial Ledger
                await new FinancialLedger({
                    userId: booking.userId,
                    type: 'REFUND',
                    amount: totalRefundToWallet,
                    description: `Refund for cancelled booking ${booking.bookingId || booking._id.toString()}`,
                    balanceAfter: user.walletBalance,
                    referenceId: booking.bookingId || booking._id.toString(),
                    metadata: { bookingId: booking._id, paymentMethod: booking.paymentMethod, pointsUsed: booking.pointsUsed }
                }).save();

                // Add to status history that refund was processed
                booking.statusHistory.push({
                    status: 'Refunded',
                    timestamp: new Date(),
                    updatedBy: 'SYSTEM',
                    notes: refundNotes.join(' ')
                });
                await booking.save();
            }
        }

        // Trigger automation hook
        await triggerAutomation('booking.cancelled', booking);

        // Notify Customer (SMS & Email) — 🆕
        (async () => {
            const customer = await User.findById(booking.userId);
            if (customer) {
                sendBookingCancelledSms(customer._id, customer.name || 'Customer', booking.bookingId).catch(o => {});
                sendBookingCancelledEmail(customer, booking).catch(o => {});
            }
        })();

        res.json({ message: 'Booking cancelled successfully', booking });
    } catch (err) {
        console.error('Error cancelling booking:', err);
        res.status(500).json({ message: 'Failed to cancel booking' });
    }
});

// PATCH: Reschedule booking
router.patch('/:id/reschedule', verifyToken, async (req, res) => {
    try {
        const { scheduledDate, scheduledTimeSlot } = req.body;

        if (!scheduledDate || !scheduledTimeSlot) {
            return res.status(400).json({ message: 'Missing scheduledDate or scheduledTimeSlot' });
        }

        const booking = await Booking.findById(req.params.id);

        if (!booking) {
            return res.status(404).json({ message: 'Booking not found' });
        }

        // Check if user owns the booking or is admin
        if (booking.userId.toString() !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Check if booking can be rescheduled
        if (['Completed', 'Cancelled'].includes(booking.status)) {
            return res.status(400).json({ message: 'Cannot reschedule completed or cancelled booking' });
        }

        booking.scheduledDate = new Date(scheduledDate);
        booking.scheduledTimeSlot = scheduledTimeSlot;
        booking.status = 'Rescheduled';
        booking.statusHistory.push({
            status: 'Rescheduled',
            timestamp: new Date(),
            updatedBy: req.user.id,
            notes: `Rescheduled to ${scheduledDate} ${scheduledTimeSlot}`
        });

        await booking.save();
        cache.del('dashboard_stats:role=admin&org=global');

        // Trigger automation hook
        await triggerAutomation('booking.rescheduled', booking);

        res.json({ message: 'Booking rescheduled successfully', booking });
    } catch (err) {
        console.error('Error rescheduling booking:', err);
        res.status(500).json({ message: 'Failed to reschedule booking' });
    }
});

/* =====================
   ADMIN ENDPOINTS
===================== */

// GET: Get all bookings with filters (admin and supervisor)
router.get('/admin/all', verifyToken, isAdminOrEngineer, async (req, res) => {
    try {
        const { status, serviceId, startDate, endDate } = req.query;

        let query = {};

        if (status) {
            query.status = status;
        }

        if (serviceId) {
            query.serviceId = serviceId;
        }

        if (startDate || endDate) {
            query.scheduledDate = {};
            if (startDate) {
                query.scheduledDate.$gte = new Date(startDate);
            }
            if (endDate) {
                query.scheduledDate.$lte = new Date(endDate);
            }
        }

        // Supervisor/Engineer Scoping: Only see relevant bookings
        if (req.user.role === 'engineer') {
            if (req.user.organisationId) {
                // Org Engineer sees only their org's bookings
                query.organisationId = req.user.organisationId;
            } else {
                // Global Engineer sees only individual (non-org) bookings
                query = {
                    ...query,
                    $or: [
                        { organisationId: null },
                        { organisationId: { $exists: false } }
                    ]
                };
            }
        }

        const bookings = await Booking.find(query)
            .populate('userId', 'name phone email')
            .populate('serviceId', 'name category')
            .populate('packageId', 'name price')
            .populate('addressId')
            .populate('assignedTechnician', 'name phone')
            .sort({ createdAt: -1 })
            .lean();

        res.json(bookings);
    } catch (err) {
        console.error('Error fetching all bookings:', err);
        res.status(500).json({ message: 'Failed to fetch bookings' });
    }
});

// PATCH: Confirm booking (admin/engineer)
router.patch('/:id/confirm', verifyToken, isAdminOrEngineer, async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id);

        if (!booking) {
            return res.status(404).json({ message: 'Booking not found' });
        }

        // 🛡️ LOCK
        if (['Completed', 'Cancelled'].includes(booking.status)) {
            return res.status(400).json({ message: `Cannot confirm a ${booking.status.toLowerCase()} booking` });
        }

        if (booking.status !== 'Pending') {
            return res.status(400).json({ message: 'Only pending bookings can be confirmed' });
        }

        // 🛡️ SECURITY FIX: Scope Check
        if (req.user.role === 'engineer') {
            if (req.user.organisationId && booking.organisationId?.toString() !== req.user.organisationId) {
                return res.status(403).json({ message: 'Access denied: Booking belongs to another organisation' });
            }
            if (!req.user.organisationId && booking.organisationId) {
                return res.status(403).json({ message: 'Access denied: Global engineers manage individual bookings' });
            }
        }

        booking.status = 'Confirmed';
        booking.statusHistory.push({
            status: 'Confirmed',
            timestamp: new Date(),
            updatedBy: req.user.id,
            notes: 'Booking confirmed by admin'
        });

        await booking.save();
        cache.del('dashboard_stats:role=admin&org=global');

        // Trigger automation hook
        await triggerAutomation('booking.confirmed', booking);

        res.json({ message: 'Booking confirmed successfully', booking });
    } catch (err) {
        console.error('Error confirming booking:', err);
        res.status(500).json({ message: 'Failed to confirm booking' });
    }
});

// PATCH: Assign agency/organisation (admin/engineer)
router.patch('/:id/assign-agency', verifyToken, isAdminOrEngineer, async (req, res) => {
    try {
        const { organisationId } = req.body;

        if (!organisationId) {
            return res.status(400).json({ message: 'Organisation ID required' });
        }

        // Verify organisation exists and has correct role
        const organisation = await User.findById(organisationId);
        if (!organisation || organisation.role !== 'organisation') {
            return res.status(404).json({ message: 'Organisation not found' });
        }

        const booking = await Booking.findById(req.params.id);

        if (!booking) {
            return res.status(404).json({ message: 'Booking not found' });
        }

        // 🛡️ LOCK
        if (['Completed', 'Cancelled'].includes(booking.status)) {
            return res.status(400).json({ message: `Cannot assign agency to a ${booking.status.toLowerCase()} booking` });
        }

        // 🛡️ SECURITY FIX: Scope Check
        if (req.user.role === 'engineer') {
            if (req.user.organisationId && booking.organisationId?.toString() !== req.user.organisationId) {
                return res.status(403).json({ message: 'Access denied: Target booking outside your scope' });
            }
        }

        booking.organisationId = organisationId;
        // Reset technician if agency changes? Probably a good idea
        booking.assignedTechnician = undefined;

        booking.statusHistory.push({
            status: booking.status,
            timestamp: new Date(),
            updatedBy: req.user.id,
            notes: `Assigned to Agency: ${organisation.name || organisation.username}`
        });

        await booking.save();

        // Populate for response
        const updatedBooking = await Booking.findById(booking._id)
            .populate('userId', 'name phone email')
            .populate('serviceId', 'name category')
            .populate('packageId', 'name price')
            .populate('addressId')
            .populate('assignedTechnician', 'name phone')
            .populate('organisationId', 'name phone email username');

        res.json({ message: 'Agency assigned successfully', booking: updatedBooking });
    } catch (err) {
        console.error('Error assigning agency:', err);
        res.status(500).json({ message: 'Failed to assign agency' });
    }
});

// PATCH: Assign technician (admin/engineer/partner)
router.patch('/:id/assign', verifyToken, canManageBookings, async (req, res) => {
    try {
        const { technicianId } = req.body;
        const booking = await Booking.findById(req.params.id);

        if (!booking) {
            return res.status(404).json({ message: 'Booking not found' });
        }

        // 🛡️ LOCK
        if (['Completed', 'Cancelled'].includes(booking.status)) {
            return res.status(400).json({ message: `Cannot assign technician to a ${booking.status.toLowerCase()} booking` });
        }

        // Access Control: If partner, booking must belong to them
        if (req.user.role === 'organisation' && booking.organisationId?.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Access denied: This booking is not assigned to your agency' });
        }

        if (!technicianId) {
            return res.status(400).json({ message: 'Technician ID required' });
        }

        // Verify technician exists and has correct role
        const technician = await User.findById(technicianId);
        if (!technician || technician.role !== 'technician') {
            return res.status(404).json({ message: 'Technician not found' });
        }

        // Access Control: If partner, technician must belong to them
        if (req.user.role === 'organisation' && technician.organisationId?.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Access denied: Technician belongs to another agency' });
        }

        // Booking already found and existence/permission checked above

        booking.assignedTechnician = technicianId;
        booking.assignedAt = new Date();
        booking.status = 'Assigned';
        booking.statusHistory.push({
            status: 'Assigned',
            timestamp: new Date(),
            updatedBy: req.user.id,
            notes: `Assigned to ${technician.name}`
        });

        await booking.save();

        // Trigger automation hook
        await triggerAutomation('booking.assigned', booking);

        // Notify Technician (push)
        await sendUserNotification(
            technicianId,
            'New Service Assignment',
            `You have been assigned to booking ${booking.bookingId}.`,
            { bookingId: booking._id.toString(), type: 'assignment' }
        );

        // Notify User (push)
        await sendUserNotification(
            booking.userId,
            'Technician Assigned',
            `Technician ${technician.name} has been assigned to your booking ${booking.bookingId}.`,
            { bookingId: booking._id.toString(), type: 'assignment' }
        );

        // SMS: Technician Assigned — to Customer
        sendTechnicianAssignedSms(
            booking.userId,
            (await User.findById(booking.userId).select('name'))?.name || 'Customer',
            booking.bookingId,
            technician.name
        ).catch(e => console.error('[SMS] technician assigned (user) error:', e));

        // 🔥 Email: Technician Assigned — to Customer
        (async () => {
            const customer = await User.findById(booking.userId);
            if (customer) sendTechnicianAssignedEmail(customer, technician, booking).catch(e => console.error('[Email] tech assignment error:', e));
        })();

        // SMS: Job Assigned — to Technician
        sendJobAssignedToTechnicianSms(
            technicianId,
            technician.name,
            booking.bookingId
        ).catch(e => console.error('[SMS] job assigned (tech) error:', e));

        res.json({ message: 'Technician assigned successfully', booking });
    } catch (err) {
        console.error('Error assigning technician:', err);
        res.status(500).json({ message: 'Failed to assign technician' });
    }
});

// PATCH: Update booking status (admin/engineer/partner)
router.patch('/:id/status', verifyToken, canManageBookings, async (req, res) => {
    try {
        const { status, notes } = req.body;

        if (!status) {
            return res.status(400).json({ message: 'Status required' });
        }

        const booking = await Booking.findById(req.params.id);

        if (!booking) {
            return res.status(404).json({ message: 'Booking not found' });
        }

        // 🛡️ LOCK
        if (['Completed', 'Cancelled'].includes(booking.status)) {
            return res.status(400).json({ message: `Cannot update status of a ${booking.status.toLowerCase()} booking` });
        }

        // 🛡️ SECURITY FIX: Scope Check
        if (req.user.role === 'organisation' && booking.organisationId?.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Access denied: Booking outside your organisation' });
        }
        if (req.user.role === 'engineer') {
            if (req.user.organisationId && booking.organisationId?.toString() !== req.user.organisationId) {
                return res.status(403).json({ message: 'Access denied: Booking outside your organisation' });
            }
            if (!req.user.organisationId && booking.organisationId) {
                return res.status(403).json({ message: 'Access denied: Global engineers manage individual bookings' });
            }
        }

        booking.status = status;
        booking.statusHistory.push({
            status,
            timestamp: new Date(),
            updatedBy: req.user.id,
            notes
        });

        if (status === 'Completed') {
            booking.completedAt = new Date();
        }

        await booking.save();

        // Trigger automation hook based on status
        const eventMap = {
            'In Progress': 'booking.in_progress',
            'Completed': 'booking.completed'
        };

        if (eventMap[status]) {
            await triggerAutomation(eventMap[status], booking);

            if (status === 'Completed') {
                await sendUserNotification(
                    booking.userId,
                    'Service Completed',
                    `Your service for booking ${booking.bookingId} has been completed. Please share your feedback!`,
                    { bookingId: booking._id.toString(), type: 'completion' }
                );

                // Auto-generate Invoice
                const invoice = await autoGenerateInvoice(booking._id);
                
                // Record Technician Earning (Partner Payment System)
                if (booking.paymentStatus === 'paid' || booking.paymentMethod === 'COD') {
                    await recordTechnicianEarning(booking).catch(e => console.error('[Finance] Earning error:', e));
                }

                // SMS: Service Completed — to Customer
                const completedUser = await User.findById(booking.userId).select('name email username');
                sendServiceCompletedSms(
                    booking.userId,
                    completedUser?.name || 'Customer',
                    booking.bookingId
                ).catch(e => console.error('[SMS] service completed error:', e));

                // 🔥 Email: Service Completed — to Customer
                if (completedUser) {
                    sendJobCompletedEmail(completedUser, booking, invoice).catch(e => console.error('[Email] job completed error:', e));
                }
            }
        }

        res.json({ message: 'Booking status updated successfully', booking });
    } catch (err) {
        console.error('Error updating booking status:', err);
        res.status(500).json({ message: 'Failed to update booking status' });
    }
});

// DELETE: Delete booking (Admin Only)
router.delete('/admin/:id', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Admin access required' });
        }
        const booking = await Booking.findByIdAndDelete(req.params.id);
        if (!booking) return res.status(404).json({ message: 'Booking not found' });
        cache.del('dashboard_stats:role=admin&org=global');
        res.json({ message: 'Booking deleted successfully' });
    } catch (err) {
        console.error('Error deleting booking:', err);
        res.status(500).json({ message: 'Failed to delete booking' });
    }
});

/* =====================
   TECHNICIAN ENDPOINTS
===================== */

// GET: Get technician's assigned bookings
router.get('/technician/my-assignments', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'technician') {
            return res.status(403).json({ message: 'Technician access required' });
        }

        const { status } = req.query;

        let query = { assignedTechnician: req.user.id };

        if (status) {
            query.status = status;
        }

        const bookings = await Booking.find(query)
            .populate('userId', 'name phone')
            .populate('serviceId', 'name category description')
            .populate('packageId', 'name price features')
            .populate('addressId')
            .sort({ scheduledDate: 1 });

        res.json(bookings);
    } catch (err) {
        console.error('Error fetching technician assignments:', err);
        res.status(500).json({ message: 'Failed to fetch assignments' });
    }
});

// PATCH: Start service (technician only)
router.patch('/:id/start', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'technician') {
            return res.status(403).json({ message: 'Technician access required' });
        }

        const booking = await Booking.findById(req.params.id);

        if (!booking) {
            return res.status(404).json({ message: 'Booking not found' });
        }

        // 🛡️ LOCK
        if (['Completed', 'Cancelled'].includes(booking.status)) {
            return res.status(400).json({ message: `Cannot start a ${booking.status.toLowerCase()} booking` });
        }

        // Check if technician is assigned to this booking
        if (!booking.assignedTechnician || booking.assignedTechnician.toString() !== req.user.id) {
            return res.status(403).json({ message: 'You are not assigned to this booking' });
        }

        if (booking.status !== 'Assigned') {
            return res.status(400).json({ message: 'Booking must be in Assigned status to start' });
        }

        booking.status = 'Started'; // 🆕 Updated status flow
        booking.statusHistory.push({
            status: 'Started',
            timestamp: new Date(),
            updatedBy: req.user.id,
            notes: 'Service marked as Started by technician'
        });

        await booking.save();

        // Trigger automation hook
        await triggerAutomation('booking.started', booking);

        // Notify User
        await sendUserNotification(
            booking.userId,
            'Technician Started Service',
            `Technician has started working on your service ${booking.bookingId}.`,
            { bookingId: booking._id.toString(), type: 'status_update' }
        );

        // Notify Admin
        await sendTopicNotification(
            'admin',
            'Service Started',
            `Service ${booking.bookingId} marked as In Progress by technician.`,
            { bookingId: booking._id.toString(), type: 'status_update' }
        );

        res.json({ message: 'Service started successfully', booking });
    } catch (err) {
        console.error('Error starting service:', err);
        res.status(500).json({ message: 'Failed to start service' });
    }
});

// PATCH: Complete service (technician only)
router.patch('/:id/complete', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'technician') {
            return res.status(403).json({ message: 'Technician access required' });
        }

        const { technicianNotes } = req.body;

        const booking = await Booking.findById(req.params.id);

        if (!booking) {
            return res.status(404).json({ message: 'Booking not found' });
        }

        // 🛡️ LOCK
        if (['Completed', 'Cancelled'].includes(booking.status)) {
            return res.status(400).json({ message: `Booking is already ${booking.status.toLowerCase()}` });
        }

        // Check if technician is assigned to this booking
        if (!booking.assignedTechnician || booking.assignedTechnician.toString() !== req.user.id) {
            return res.status(403).json({ message: 'You are not assigned to this booking' });
        }

        if (booking.status !== 'In Progress') {
            return res.status(400).json({ message: 'Booking must be in In Progress status to complete' });
        }

        booking.status = 'Completed';
        booking.completedAt = new Date();
        booking.technicianNotes = technicianNotes;
        booking.statusHistory.push({
            status: 'Completed',
            timestamp: new Date(),
            updatedBy: req.user.id,
            notes: technicianNotes || 'Service completed by technician'
        });

        await booking.save();

        // Trigger automation hook
        await triggerAutomation('booking.completed', booking);

        // Direct Notification to User
        await sendUserNotification(
            booking.userId,
            'Service Completed',
            `Your service for booking ${booking.bookingId} has been completed. Please share your feedback!`,
            { bookingId: booking._id.toString(), type: 'completion' }
        );

        // Notify Admin
        await sendTopicNotification(
            'admin',
            'Service Completed',
            `Service ${booking.bookingId} marked as Completed by technician.`,
            { bookingId: booking._id.toString(), type: 'completion' }
        );

        // Auto-generate Invoice directly to ensure it exists for download
        await autoGenerateInvoice(booking._id);

        // 🔥 SMS & Email: Service Completed (via technician action)
        (async () => {
            const completedUser = await User.findById(booking.userId);
            if (completedUser) {
                // SMS
                sendServiceCompletedSms(booking.userId, completedUser.name || 'Customer', booking.bookingId).catch(o => {});
                // Email
                sendJobCompletedEmail(completedUser, booking).catch(e => console.error('[Email] tech complete email error:', e));
            }
        })();

        // Record Technician Earning (Partner Payment System)
        if (booking.paymentStatus === 'paid' || booking.paymentMethod === 'COD') {
            await recordTechnicianEarning(booking).catch(e => console.error('[Finance] Tech Earning error:', e));
        }

        res.json({ message: 'Service completed successfully', booking });
    } catch (err) {
        console.error('Error completing service:', err);
        res.status(500).json({ message: 'Failed to complete service' });
    }
});

/* =====================
   COMMUNICATION & FIELD UPDATES
===================== */

// GET: WhatsApp URL to contact customer (Technician/Admin only)
router.get('/:id/whatsapp/user', verifyToken, async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id).populate('userId', 'phone name');
        if (!booking) return res.status(404).json({ message: 'Booking not found' });

        // Access check
        if (req.user.role !== 'admin' && booking.assignedTechnician?.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Access denied' });
        }

        const phone = booking.userId?.phone;
        if (!phone) return res.status(400).json({ message: 'Customer phone not found' });

        const message = encodeURIComponent(`Hi ${booking.userId.name}, this is your technician regarding your WattOrbit booking ${booking.bookingId}.`);
        const waUrl = `https://wa.me/91${phone}?text=${message}`;

        res.json({ waUrl });
    } catch (err) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET: WhatsApp URL to contact technician (User/Admin only)
router.get('/:id/whatsapp/technician', verifyToken, async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id).populate('assignedTechnician', 'phone name');
        if (!booking) return res.status(404).json({ message: 'Booking not found' });

        // Access check
        if (req.user.role !== 'admin' && booking.userId.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Access denied' });
        }

        const tech = booking.assignedTechnician;
        if (!tech || !tech.phone) return res.status(400).json({ message: 'Technician not assigned or phone missing' });

        const message = encodeURIComponent(`Hi ${tech.name}, I am contacting you regarding my WattOrbit booking ${booking.bookingId}.`);
        const waUrl = `https://wa.me/91${tech.phone}?text=${message}`;

        res.json({ waUrl });
    } catch (err) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PATCH: Generic update for technicians (Web Dashboard compatibility)
router.patch('/:id/tech-update', verifyToken, async (req, res) => {
    try {
        const { status, remark, paymentReceived, customerBehavior, userRating } = req.body;
        const booking = await Booking.findById(req.params.id);

        if (!booking) return res.status(404).json({ message: 'Booking not found' });

        // 🛡️ LOCK
        if (['Completed', 'Cancelled'].includes(booking.status)) {
            return res.status(400).json({ message: `Cannot update a ${booking.status.toLowerCase()} booking` });
        }

        // Access check: Only assigned technician or admin
        if (req.user.role !== 'admin' && req.user.role !== 'engineer' && booking.assignedTechnician?.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Access denied' });
        }

        if (status) booking.status = status;
        if (remark) booking.technicianNotes = remark;
        if (paymentReceived !== undefined) booking.paymentReceived = paymentReceived;
        if (customerBehavior) booking.customerBehavior = customerBehavior;

        // Update User Rating if provided
        if (userRating !== undefined && userRating > 0) {
            const oldRating = booking.userRating || 0;
            booking.userRating = userRating;

            const user = await User.findById(booking.userId);
            if (user) {
                if (oldRating === 0) {
                    // New rating
                    const newTotal = user.totalRatings + 1;
                    user.averageRating = ((user.averageRating * user.totalRatings) + userRating) / newTotal;
                    user.totalRatings = newTotal;
                } else {
                    // Update existing rating
                    user.averageRating = ((user.averageRating * user.totalRatings) - oldRating + userRating) / user.totalRatings;
                }
                await user.save();
            }
        }

        booking.statusHistory.push({
            status: status || booking.status,
            timestamp: new Date(),
            updatedBy: req.user.id,
            notes: remark || 'Status updated via dashboard'
        });

        if (status === 'Completed' || paymentReceived === true) {
            if (status === 'Completed') {
                booking.completedAt = new Date();

                // Notify User
                await sendUserNotification(
                    booking.userId,
                    'Service Completed',
                    `Your service for booking ${booking.bookingId} has been completed. Please share your feedback!`,
                    { bookingId: booking._id.toString(), type: 'completion' }
                );
            }

            await booking.save();

            // Auto-generate Invoice directly to ensure it exists for download
            await autoGenerateInvoice(booking._id);

            if (status === 'Completed') {
                // Trigger completion automations (notifications etc)
                await triggerAutomation('booking.completed', booking);
                
                // Record Technician Earning (Partner Payment System)
                if (booking.paymentStatus === 'paid' || booking.paymentMethod === 'COD' || booking.paymentReceived === true) {
                    await recordTechnicianEarning(booking).catch(e => console.error('[Finance] Dashboard Earning error:', e));
                }
            }
        } else {
            await booking.save();
        }

        res.json({ message: 'Booking updated successfully', booking });
    } catch (err) {
        console.error('Tech update error:', err);
        res.status(500).json({ message: 'Failed to update booking' });
    }
});

// GET: Technician Dashboard Statistics
router.get('/technician/stats', verifyToken, async (req, res) => {
    try {
        let techId = req.user.id;
        const queryTechId = req.query.techId;

        // Authorization
        if (queryTechId && queryTechId !== techId) {
            if (req.user.role !== 'admin' && req.user.role !== 'engineer') {
                return res.status(403).json({ message: 'Unauthorized to view other technician stats' });
            }
            techId = queryTechId;
        } else if (req.user.role !== 'technician' && !queryTechId) {
             return res.status(400).json({ message: 'Technician ID required' });
        }

        // Fetch technician details for context (especially for engineers)
        const technician = await User.findById(techId).select('name availabilityStatus walletBalance');
        if (!technician) return res.status(404).json({ message: 'Technician not found' });

        // Fetch all jobs for basic counts
        const allJobs = await Booking.find({ assignedTechnician: techId });

        const stats = {
            technicianName: technician.name,
            availabilityStatus: technician.availabilityStatus,
            walletBalance: technician.walletBalance || 0,
            totalEarnings: 0,
            assignedJobs: 0,
            completedJobs: 0,
            cancelledJobs: 0,
            weeklyEarnings: [0, 0, 0, 0, 0, 0, 0] // [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
        };

        const today = new Date();
        const last7Days = new Date(today);
        last7Days.setDate(today.getDate() - 7);

        // Basic counts from bookings
        allJobs.forEach(job => {
            if (job.status === 'Assigned') stats.assignedJobs++;
            if (job.status === 'Completed') stats.completedJobs++;
            if (job.status === 'Cancelled') stats.cancelledJobs++;
        });

        // Exact earnings from TechnicianEarning for accuracy and consistency
        const earningsRaw = await TechnicianEarning.find({ technicianId: techId, status: 'credited' });
        
        earningsRaw.forEach(earning => {
            const amount = earning.technicianShare || 0;
            stats.totalEarnings += amount;

            // Simple weekly grouping for UI graph (0 = Sunday... we want Mon-Sun 0-6)
            if (earning.createdAt >= last7Days) {
                const day = earning.createdAt.getDay(); // 0 is Sunday, 1 is Monday...
                const index = day === 0 ? 6 : day - 1; // Map to 0-6 starting Monday
                stats.weeklyEarnings[index] += amount;
            }
        });

        res.json(stats);
    } catch (err) {
        console.error('Stats error:', err);
        res.status(500).json({ message: 'Failed to fetch statistics' });
    }
});

/* =====================
   EMPLOYEE-INITIATED REQUESTS
===================== */

/**
 * POST: Initiate service request for a user (Existing or New)
 * Requires OTP confirmation from the user to finalize.
 */
router.post('/employee/initiate-request', verifyToken, isAdminOrEngineer, async (req, res) => {
    try {
        const {
            phone,
            email,
            name,
            serviceId,
            packageId,
            addressDetails, // { flatNo, building, street, landmark, city, state, pincode }
            addressId,      // If using existing address
            scheduledDate,
            scheduledTimeSlot,
            customerNotes
        } = req.body;

        if (!phone || !serviceId || !packageId || !scheduledDate || !scheduledTimeSlot) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        // 1. Find or Create User
        let user = await User.findOne({ phone: phone.trim() });
        let isNewUser = false;

        if (!user) {
            // Create user without password (OTP Login only)
            user = new User({
                phone: phone.trim(),
                email: email ? email.toLowerCase().trim() : undefined,
                name: name || 'Customer',
                username: phone.trim(),
                role: 'user',
                isApproved: true,
                walletBalance: 0 // Welcome Bonus Disabled
            });
            await user.save();
            isNewUser = true;
        }

        // 2. Handle Address
        let finalAddressId = addressId;
        if (!finalAddressId && addressDetails) {
            const newAddress = new Address({
                userId: user._id,
                ...addressDetails,
                contactName: user.name,
                contactPhone: user.phone
            });
            await newAddress.save();
            finalAddressId = newAddress._id;
        }

        if (!finalAddressId) {
            return res.status(400).json({ message: 'Address is required (addressId or addressDetails)' });
        }

        // 3. Service & Package Validation
        const service = await Service.findById(serviceId);
        const servicePackage = await ServicePackage.findById(packageId);

        if (!service || !servicePackage || servicePackage.serviceId.toString() !== serviceId) {
            return res.status(404).json({ message: 'Invalid service or package' });
        }

        // 4. Calculate Pricing (Simplified for Employee Dashboard)
        const technicianCharges = servicePackage.technicianCharges || 0;
        const platformFees = servicePackage.platformFees || 0;
        const taxes = Math.round((platformFees * 18) / 100);
        const basePrice = technicianCharges + platformFees;
        const totalAmount = basePrice + taxes;

        // 5. Generate OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpires = Date.now() + 600000; // 10 minutes

        // 6. Create Booking (Awaiting Confirmation)
        const bookingId = await generateBookingId();
        const booking = new Booking({
            bookingId,
            userId: user._id,
            serviceId,
            packageId,
            addressId: finalAddressId,
            scheduledDate: new Date(scheduledDate),
            scheduledTimeSlot,
            customerNotes,
            basePrice,
            technicianCharges,
            platformFees,
            taxes,
            totalAmount,
            paymentMethod: 'COD',
            status: 'Awaiting Confirmation',
            serviceOTP: otp,
            serviceOTPExpires: otpExpires,
            statusHistory: [{
                status: 'Awaiting Confirmation',
                timestamp: new Date(),
                updatedBy: req.user.id,
                notes: `Initiated by employee ${req.user.name || req.user.id}`
            }]
        });

        await booking.save();

        // 7. Send OTP
        sendServiceRequestOTPSms(user.phone, otp).catch(e => console.error('[SMS] Service OTP error:', e));
        if (user.email) {
            sendServiceRequestOTPEmail(user, otp).catch(e => console.error('[Email] Service OTP error:', e));
        }

        res.status(201).json({
            message: 'Service request initiated. OTP sent to user.',
            bookingId: booking._id,
            displayId: booking.bookingId,
            isNewUser
        });

    } catch (err) {
        console.error('Initiate request error:', err);
        res.status(500).json({ message: 'Failed to initiate service request' });
    }
});

/**
 * POST: Confirm employee-initiated request with OTP
 */
router.post('/employee/confirm-request', verifyToken, isAdminOrEngineer, async (req, res) => {
    try {
        const { bookingId, otp } = req.body;

        if (!bookingId || !otp) {
            return res.status(400).json({ message: 'Booking ID and OTP are required' });
        }

        const booking = await Booking.findById(bookingId);
        if (!booking) return res.status(404).json({ message: 'Booking not found' });

        if (booking.status !== 'Awaiting Confirmation') {
            return res.status(400).json({ message: 'Booking is not in awaiting confirmation state' });
        }

        // Verify OTP
        if (booking.serviceOTP !== otp || booking.serviceOTPExpires < Date.now()) {
            return res.status(401).json({ message: 'Invalid or expired OTP' });
        }

        // Clear OTP and update status to Pending
        booking.serviceOTP = undefined;
        booking.serviceOTPExpires = undefined;
        const nextStatus = booking.isDemo ? 'Assigned' : 'Pending';
        booking.status = nextStatus;
        booking.statusHistory.push({
            status: nextStatus,
            timestamp: new Date(),
            updatedBy: req.user.id,
            notes: 'User verified via OTP. Booking confirmed.'
        });

        await booking.save();

        // Trigger Standard automations
        const service = await Service.findById(booking.serviceId);
        const user = await User.findById(booking.userId);

        await triggerAutomation('booking.created', booking);
        
        // Notify Customer (Push + SMS + Email)
        sendBookingCreatedSms(user._id, user.name || 'Customer', booking.bookingId, service.name).catch(o => {});
        sendBookingCreatedEmail(user, booking, service.name).catch(o => {});

        res.json({
            message: 'Booking confirmed successfully',
            booking
        });

    } catch (err) {
        console.error('Confirm request error:', err);
        res.status(500).json({ message: 'Failed to confirm booking' });
    }
});

/**
 * POST: Create a Demo Booking (bypass OTP, pre-assign tech)
 */
router.post('/employee/demo-booking', verifyToken, isAdminOrEngineer, async (req, res) => {
    try {
        const {
            phone, email, name,
            serviceId, packageId,
            technicianId,
            addressDetails,
            scheduledDate, scheduledTimeSlot,
            customerNotes,
            skipOtp
        } = req.body;

        if (!phone || !serviceId || !packageId || !technicianId) {
            return res.status(400).json({ message: 'Missing required demo fields' });
        }

        // 1. Find or Create User
        let user = await User.findOne({ phone: phone.trim() });
        if (!user) {
            user = new User({
                phone: phone.trim(),
                email: email ? email.toLowerCase().trim() : undefined,
                name: name || 'Demo Customer',
                username: `demo_${phone.trim()}`,
                role: 'user',
                isApproved: true
            });
            await user.save();
        }

        // 2. Handle Address
        const newAddress = new Address({
            userId: user._id,
            ...addressDetails,
            contactName: user.name,
            contactPhone: user.phone
        });
        await newAddress.save();

        // 3. Service & Package
        const service = await Service.findById(serviceId);
        const servicePackage = await ServicePackage.findById(packageId);
        const technician = await User.findById(technicianId);

        if (!service || !servicePackage || !technician) {
            return res.status(404).json({ message: 'Invalid service, package, or technician' });
        }

        // 4. Pricing
        const technicianCharges = servicePackage.technicianCharges || 0;
        const platformFees = servicePackage.platformFees || 0;
        const taxes = Math.round((platformFees * 18) / 100);
        const basePrice = technicianCharges + platformFees;
        const totalAmount = basePrice + taxes;

        // 5. Create Booking
        const bookingId = await generateBookingId();
        const status = skipOtp ? 'Assigned' : 'Awaiting Confirmation';
        const otp = skipOtp ? undefined : Math.floor(100000 + Math.random() * 900000).toString();

        const booking = new Booking({
            bookingId,
            userId: user._id,
            serviceId,
            packageId,
            addressId: newAddress._id,
            scheduledDate: new Date(scheduledDate || Date.now()),
            scheduledTimeSlot: scheduledTimeSlot || '10:00 AM - 12:00 PM',
            customerNotes: `[DEMO] ${customerNotes || ''}`,
            basePrice,
            technicianCharges,
            platformFees,
            taxes,
            totalAmount,
            paymentMethod: 'COD',
            status,
            serviceOTP: otp,
            serviceOTPExpires: otp ? Date.now() + 600000 : undefined,
            assignedTechnician: technicianId,
            assignedAt: skipOtp ? new Date() : undefined,
            isDemo: true,
            statusHistory: [{
                status,
                timestamp: new Date(),
                updatedBy: req.user.id,
                notes: `Demo initiated by employee ${req.user.name || req.user.id}`
            }]
        });

        await booking.save();

        // 6. Notifications (Genuine)
        if (!skipOtp) {
            sendServiceRequestOTPSms(user.phone, otp).catch(o => {});
        } else {
            // Send Booking Created & Tech Assigned Notifications
            sendBookingCreatedSms(user._id, user.name, booking.bookingId, service.name).catch(o => {});
            sendBookingCreatedEmail(user, booking, service.name).catch(o => {});
            
            // Tech Assignments
            sendUserNotification(technicianId, 'New Demo Assignment', `Assigned to demo booking ${booking.bookingId}`, { bookingId: booking._id.toString() }).catch(o => {});
            sendJobAssignedToTechnicianSms(technicianId, technician.name, booking.bookingId).catch(o => {});
            
            sendUserNotification(user._id, 'Technician Assigned', `Tech ${technician.name} assigned to your demo ${booking.bookingId}`, { bookingId: booking._id.toString() }).catch(o => {});
            sendTechnicianAssignedSms(user._id, user.name, booking.bookingId, technician.name).catch(o => {});
            sendTechnicianAssignedEmail(user, technician, booking).catch(o => {});
        }

        res.status(201).json({ message: 'Demo booking created', booking });

    } catch (err) {
        console.error('Demo booking error:', err);
        res.status(500).json({ message: 'Failed to create demo booking' });
    }
});

/**
 * POST: Reset all Demo data (Admin/Employee only)
 */
router.post('/admin/reset-demos', verifyToken, isAdminOrEngineer, async (req, res) => {
    try {
        // 1. Find all demo ledger entries to revert balances
        const demoLedgers = await FinancialLedger.find({ isDemo: true });
        
        for (const entry of demoLedgers) {
            const user = await User.findById(entry.userId);
            if (user) {
                // Revert balance: subtract what was added, add what was subtracted
                user.walletBalance -= entry.amount; 
                await user.save();
            }
        }

        // 2. Delete all demo records
        const demoBookings = await Booking.find({ isDemo: true });
        const demoBookingIds = demoBookings.map(b => b._id);

        await Promise.all([
            Booking.deleteMany({ isDemo: true }),
            TechnicianEarning.deleteMany({ isDemo: true }),
            FinancialLedger.deleteMany({ isDemo: true }),
            Invoice.deleteMany({ bookingId: { $in: demoBookingIds } })
        ]);

        cache.del('dashboard_stats:role=admin&org=global');

        res.json({ 
            message: 'Demo data reset successfully',
            clearedCount: demoBookingIds.length 
        });

    } catch (err) {
        console.error('Reset demo error:', err);
        res.status(500).json({ message: 'Failed to reset demo data' });
    }
});

const { recalculateBooking } = require('../utils/pricingHelper');

/* =====================
   MULTIPLE SERVICE ENHANCEMENTS
===================== */

/**
 * POST: Add an extra service to an existing booking (Technician/Admin only)
 */
router.post('/:id/add-service', verifyToken, async (req, res) => {
    try {
        const { serviceId, packageId } = req.body;
        const booking = await Booking.findById(req.params.id);

        if (!booking) return res.status(404).json({ message: 'Booking not found' });
        
        // 🛡️ LOCK
        if (['Completed', 'Cancelled'].includes(booking.status)) {
            return res.status(400).json({ message: `Cannot add services to a ${booking.status.toLowerCase()} booking` });
        }
        
        // Safety: Prevent adding services after payment is completed
        if (booking.paymentStatus === 'paid') {
            return res.status(400).json({ message: 'Cannot add services to a paid booking' });
        }

        // Access Check: Admin or Assigned Technician
        const isAssigned = booking.assignedTechnician && booking.assignedTechnician.toString() === req.user.id;
        if (req.user.role !== 'admin' && req.user.role !== 'employee' && !isAssigned) {
            return res.status(403).json({ message: 'Unauthorized to modify this booking' });
        }

        // Fetch Service & Package
        const service = await Service.findById(serviceId);
        const servicePackage = await ServicePackage.findById(packageId);

        if (!service || !servicePackage || servicePackage.serviceId.toString() !== serviceId) {
            return res.status(404).json({ message: 'Invalid service or package selection' });
        }

        // Add to services array
        booking.services.push({
            serviceId,
            packageId,
            name: `${service.name} (${servicePackage.name})`,
            basePrice: servicePackage.basePrice || service.basePrice,
            technicianCharges: servicePackage.technicianCharges || 0,
            platformFees: servicePackage.platformFees || 0,
            isAdditional: true
        });

        // Recalculate Totals
        await recalculateBooking(booking);
        await booking.save();

        res.json({ message: 'Service added successfully', booking });
    } catch (err) {
        console.error('Add service error:', err);
        res.status(500).json({ message: 'Failed to add service' });
    }
});

/**
 * DELETE: Remove an additional service from a booking
 */
router.delete('/:id/remove-service/:serviceIndex', verifyToken, async (req, res) => {
    try {
        const { id, serviceIndex } = req.params;
        const booking = await Booking.findById(id);

        if (!booking) return res.status(404).json({ message: 'Booking not found' });

        // 🛡️ LOCK
        if (['Completed', 'Cancelled'].includes(booking.status)) {
            return res.status(400).json({ message: `Cannot modify a ${booking.status.toLowerCase()} booking` });
        }
        if (booking.paymentStatus === 'paid') return res.status(400).json({ message: 'Cannot modify paid booking' });

        const idx = parseInt(serviceIndex);
        if (isNaN(idx) || idx < 0 || idx >= booking.services.length) {
            return res.status(400).json({ message: 'Invalid service index' });
        }

        // Prevent removing the primary service (index 0) if required, 
        // but here we allow it if there's at least one left.
        if (booking.services.length <= 1) {
            return res.status(400).json({ message: 'A booking must have at least one service' });
        }

        booking.services.splice(idx, 1);
        
        await recalculateBooking(booking);
        await booking.save();

        res.json({ message: 'Service removed successfully', booking });
    } catch (err) {
        res.status(500).json({ message: 'Failed to remove service' });
    }
});

/**
 * GET: Generate UPI Payment URI for QR display
 */
router.get('/:id/payment-qr', verifyToken, async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.status(404).json({ message: 'Booking not found' });

        const upiId = process.env.CENTRAL_UPI_ID || 'wattorbit@bank';
        const upiName = process.env.CENTRAL_UPI_NAME || 'WattOrbit Energy';
        const amount = booking.totalAmount.toFixed(2);
        const transactionNote = encodeURIComponent(`Payment for Booking ${booking.bookingId}`);
        
        // Standard UPI Dynamic URI Scheme
        const upiURI = `upi://pay?pa=${upiId}&pn=${upiName}&am=${amount}&tn=${transactionNote}&cu=INR`;

        res.json({ 
            upiURI,
            amount: booking.totalAmount,
            bookingId: booking.bookingId,
            message: 'QR URI generated for central account'
        });
    } catch (err) {
        res.status(500).json({ message: 'Failed to generate payment QR' });
    }
});

/**
 * POST: Finalize and Confirm Payment (Manual UPI Confirmation by Technician)
 */
router.post('/:id/confirm-payment', verifyToken, async (req, res) => {
    try {
        const { paymentId, notes } = req.body;
        const booking = await Booking.findById(req.params.id);

        if (!booking) return res.status(404).json({ message: 'Booking not found' });
        
        // 🛡️ LOCK
        if (['Completed', 'Cancelled'].includes(booking.status)) {
            return res.status(400).json({ message: `Cannot confirm payment for a ${booking.status.toLowerCase()} booking` });
        }
        
        // Only assigned technician or admin can confirm
        if (req.user.role !== 'admin' && booking.assignedTechnician?.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Unauthorized' });
        }

        booking.paymentStatus = 'paid';
        booking.paymentId = paymentId;
        booking.paymentReceived = true;
        booking.status = 'Completed';
        booking.completedAt = new Date();
        
        booking.statusHistory.push({
            status: 'Completed',
            timestamp: new Date(),
            updatedBy: req.user.id,
            notes: notes || `Payment confirmed via UPI. TrxID: ${paymentId}`
        });

        await booking.save();
        res.json({ message: 'Payment confirmed and job completed', booking });

    } catch (err) {
        res.status(500).json({ message: 'Failed to confirm payment' });
    }
});

/**
 * POST: Upload job progress photos (Technician only)
 */
router.post('/:id/upload-photo', verifyToken, upload.single('image'), async (req, res) => {
    try {
        const { stage } = req.body; // 'start', 'progress', 'completion'
        const booking = await Booking.findById(req.params.id);

        if (!booking) return res.status(404).json({ message: 'Booking not found' });
        
        // 🛡️ LOCK
        if (['Completed', 'Cancelled'].includes(booking.status)) {
            return res.status(400).json({ message: `Cannot upload photos to a ${booking.status.toLowerCase()} booking` });
        }
        
        // Authorization: Assigned Technician or Admin/Employee
        const isAssigned = booking.assignedTechnician?.toString() === req.user.id;
        if (req.user.role !== 'admin' && req.user.role !== 'employee' && !isAssigned) {
            return res.status(403).json({ message: 'Unauthorized to upload photos' });
        }

        if (!['start', 'progress', 'completion'].includes(stage)) {
            return res.status(400).json({ message: 'Invalid stage. Must be start, progress, or completion' });
        }

        if (!req.file) {
            return res.status(400).json({ message: 'No image file provided' });
        }

        // Limit check
        const currentPhotos = booking.jobPhotos[stage] || [];
        if (currentPhotos.length >= 3) {
            return res.status(400).json({ message: `Maximum 3 photos allowed for ${stage} stage` });
        }

        // 🆕 Photo Sequencing Rules
        if (stage === 'progress' && (!booking.jobPhotos.start || booking.jobPhotos.start.length === 0)) {
            return res.status(400).json({ message: 'Must upload "Start" photos before "Progress" photos' });
        }
        if (stage === 'completion' && (!booking.jobPhotos.progress || booking.jobPhotos.progress.length === 0)) {
            return res.status(400).json({ message: 'Must upload "Progress" photos before "Completion" photos' });
        }

        // Upload to Cloudinary
        const { url } = await uploadToCloudinary(req.file.path, `wattorbit/bookings/${booking.bookingId}/${stage}`);
        
        // Cleanup temp file
        fs.unlinkSync(req.file.path);

        // Update Booking
        booking.jobPhotos[stage].push(url);
        
        // 🆕 Auto-transition status based on photo stage
        if (stage === 'start' && booking.status === 'Started') {
            booking.status = 'In Progress';
            booking.statusHistory.push({
                status: 'In Progress',
                timestamp: new Date(),
                updatedBy: req.user.id,
                notes: 'Advanced to In Progress after Start photos uploaded'
            });
        }

        await booking.save();

        res.json({ message: 'Photo uploaded successfully', url, booking });
    } catch (err) {
        console.error('Photo upload error:', err);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ message: 'Failed to upload photo' });
    }
});

module.exports = router;
