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
const DeletedBooking = require('../models/DeletedBooking');
const { generateBookingId } = require('../utils/idGenerator');
const { round } = require('../utils/mathUtils');
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
    sendBookingCancelledEmail,
    sendAdminAlertEmail // 🆕 Admin alerts
} = require('../utils/emailHelper');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { uploadToCloudinary } = require('../utils/cloudinaryHelper');
const { recordTechnicianEarning, updateUniversalLedger } = require('../utils/technicianFinanceHelper');

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

const { 
    verifyToken, 
    isAdmin, 
    canManageBookings, 
    isAdminOrEngineer 
} = require('../middleware/authMiddleware');

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
                discount = round((basePrice * servicePackage.discount.percentage) / 100);
            }
        }

        // --- Calculate Apportionment ---
        let technicianDiscountShare = 0;
        let platformDiscountShare = discount;

        if (discount > 0 && typeof technicianAbsorbsPercent !== 'undefined' && technicianAbsorbsPercent !== null) {
            technicianDiscountShare = round((discount * technicianAbsorbsPercent) / 100);
            platformDiscountShare = round(discount - technicianDiscountShare);
        }
        
        const netPlatformFees = round(platformFees - platformDiscountShare);

        const taxRate = 18; // 18% GST on platform fees only
        const taxes = Math.max(0, round((netPlatformFees * taxRate) / 100));

        const totalAmount = Math.max(0, round(basePrice + taxes - discount - pointsToUse));

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
            await updateUniversalLedger(
                user._id,
                'TRANSFER',
                -pointsToUse,
                booking.bookingId || booking._id.toString(),
                `Used WattOrbit Case Points for booking #${booking.bookingId}`,
                { bookingId: booking._id, type: 'points_redemption' }
            ).catch(err => console.error('[Ledger] Point redemption log error:', err));
        }
        
        if (paymentMethod && ['COD', 'Online', 'Wallet'].includes(paymentMethod)) {
            user.defaultPaymentMethod = paymentMethod;
            await user.save();
        }

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

            // 📧 Admin Alert Email: New Booking
            sendAdminAlertEmail(
                `📋 New Booking ${booking.bookingId} — ${service.name}`,
                `<div style="font-family:Arial,sans-serif;max-width:500px;padding:20px;border:1px solid #ddd;border-radius:8px;">
                    <h3 style="color:#1e3a8a;">New Booking Received</h3>
                    <table style="width:100%;border-collapse:collapse;">
                        <tr><td style="padding:6px;font-weight:bold;">Booking ID</td><td style="padding:6px;">${booking.bookingId}</td></tr>
                        <tr style="background:#f8f9fa;"><td style="padding:6px;font-weight:bold;">Service</td><td style="padding:6px;">${service.name}</td></tr>
                        <tr><td style="padding:6px;font-weight:bold;">Customer</td><td style="padding:6px;">${user.name || user.username} (${user.phone})</td></tr>
                        <tr style="background:#f8f9fa;"><td style="padding:6px;font-weight:bold;">Amount</td><td style="padding:6px;">₹${booking.totalAmount}</td></tr>
                        <tr><td style="padding:6px;font-weight:bold;">Payment</td><td style="padding:6px;">${booking.paymentMethod}</td></tr>
                        <tr style="background:#f8f9fa;"><td style="padding:6px;font-weight:bold;">Scheduled</td><td style="padding:6px;">${booking.scheduledDate?.toDateString()} — ${booking.scheduledTimeSlot}</td></tr>
                    </table>
                    <p style="margin-top:16px;"><a href="https://wattorbit.in/admin/bookings" style="background:#1e3a8a;color:#fff;padding:8px 16px;text-decoration:none;border-radius:6px;">View in Admin Panel</a></p>
                </div>`
            ).catch(e => console.error('[Email] Admin booking alert error:', e));

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

        if (role === 'admin' || role === 'employee') {
            // Admin and Employee see ALL bookings (full access, no scope restriction)
            // No userId filter — they manage the platform
        } else if (role === 'organisation') {
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
            .populate('userId', 'name phone email')
            .sort({ createdAt: -1 })
            .lean();

        // 🛡️ SECURITY: Hide technician job photos ONLY from end-customers and organisations
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

// GET: Get booking details (explicit route for frontend)
router.get('/details/:id', verifyToken, async (req, res) => {
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

        // Check access: user can see their own, admin can see all
        const isOwner = booking.userId && booking.userId._id.toString() === req.user.id;
        const isAdminUser = ['admin', 'employee'].includes(req.user.role);
        
        if (!isOwner && !isAdminUser) {
            return res.status(403).json({ message: 'Unauthorized to view these booking details' });
        }

        res.json(booking);
    } catch (err) {
        console.error('Error fetching booking details:', err);
        res.status(500).json({ message: 'Failed to fetch booking details' });
    }
});

// GET: Get booking (generic route)
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

// PATCH: Admin Apply Coupon to existing booking
router.patch('/:id/admin-apply-coupon', verifyToken, isAdmin, async (req, res) => {
    try {
        const { couponCode } = req.body;
        if (!couponCode) return res.status(400).json({ message: 'Coupon code required' });

        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.status(404).json({ message: 'Booking not found' });

        const coupon = await Coupon.findOne({ code: couponCode.toUpperCase(), isActive: true });
        if (!coupon) return res.status(404).json({ message: 'Invalid or inactive coupon' });

        if (coupon.expiryDate < new Date()) {
            return res.status(400).json({ message: 'Coupon has expired' });
        }

        // Recalculate totals
        const basePrice = booking.basePrice;
        if (!coupon.isValid(basePrice)) {
            return res.status(400).json({ message: `Coupon not applicable. Min order amount: ₹${coupon.minOrderAmount}` });
        }

        const discount = coupon.calculateDiscount(basePrice);
        
        // Update booking
        booking.couponId = coupon._id;
        booking.couponCode = coupon.code;
        booking.discount = discount;

        // Apportionment
        let technicianDiscountShare = 0;
        let platformDiscountShare = discount;
        if (coupon.technicianAbsorbsPercent !== null) {
            technicianDiscountShare = Math.round((discount * coupon.technicianAbsorbsPercent) / 100);
            platformDiscountShare = discount - technicianDiscountShare;
        }
        booking.technicianDiscountShare = technicianDiscountShare;
        booking.platformDiscountShare = platformDiscountShare;

        // Recalculate Taxes and Total
        const netPlatformFees = round((booking.platformFees || 0) - (booking.platformDiscountShare || 0));
        const taxRate = 18;
        booking.taxes = Math.max(0, round((netPlatformFees * taxRate) / 100));
        booking.totalAmount = Math.max(0, round(booking.basePrice + booking.taxes - (booking.discount || 0) - (booking.pointsUsed || 0)));

        booking.statusHistory.push({
            status: booking.status,
            timestamp: new Date(),
            updatedBy: req.user.id,
            notes: `Coupon ${coupon.code} applied by Admin. Discount: ₹${discount}`
        });

        await booking.save();
        await Coupon.findByIdAndUpdate(coupon._id, { $inc: { usedCount: 1 } });
        cache.del('dashboard_stats:role=admin&org=global');

        res.json({ message: 'Coupon applied successfully', booking });
    } catch (err) {
        console.error('Admin apply coupon error:', err);
        res.status(500).json({ message: 'Failed to apply coupon' });
    }
});


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
        const { status, notes, paymentCollectedBy } = req.body;

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
        if (paymentCollectedBy) booking.paymentCollectedBy = paymentCollectedBy;

        booking.statusHistory.push({
            status,
            timestamp: new Date(),
            updatedBy: req.user.id,
            notes: notes ? `${notes}${paymentCollectedBy ? ` (Payment collected by ${paymentCollectedBy})` : ''}` : (paymentCollectedBy ? `Payment collected by ${paymentCollectedBy}` : undefined)
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

// DELETE: Delete booking (Admin Only) - 🛡️ RE-IMPLEMENTED as Audited Archive
router.delete('/admin/:id', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Admin access required' });
        }

        // 🛡️ BODY SAFETY: Some HTTP clients/proxies strip bodies from DELETE requests.
        // Accept reason from body OR query string as fallback.
        const reason = req.body?.reason || req.query?.reason;
        if (!reason || reason.trim().length < 5) {
            return res.status(400).json({ message: 'Deletion reason is required (min 5 characters)' });
        }

        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.status(404).json({ message: 'Booking not found' });

        // 🛡️ SECURITY & AUDIT: Archive before deletion
        await new DeletedBooking({
            originalBooking: booking.toObject(),
            deletionReason: reason,
            deletedBy: req.user.id,
            bookingId: booking.bookingId || booking._id.toString()
        }).save();

        // Perform actual deletion
        await Booking.findByIdAndDelete(req.params.id);

        cache.del('dashboard_stats:role=admin&org=global');
        res.json({ message: 'Booking permanently archived and deleted.' });
    } catch (err) {
        console.error('Error deleting booking:', err);
        res.status(500).json({ message: 'Failed to delete booking' });
    }
});

// POST: Correct a wrongly recorded payment method (Admin Only)
// Use case: Technician marked paymentReceived=true (online) but actually collected cash (COD)
router.post('/admin/:id/correct-payment', verifyToken, isAdmin, async (req, res) => {
    try {
        const { correctedReason } = req.body;
        if (!correctedReason || correctedReason.trim().length < 10) {
            return res.status(400).json({ message: 'A detailed correction reason is required (min 10 characters)' });
        }

        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.status(404).json({ message: 'Booking not found' });
        if (booking.status !== 'Completed') return res.status(400).json({ message: 'Can only correct completed bookings' });
        if (booking.paymentMethod === 'COD') return res.status(400).json({ message: 'Booking is already recorded as COD' });
        if (booking.paymentMethodCorrected) return res.status(400).json({ message: 'Payment method has already been corrected for this booking' });
        if (!booking.assignedTechnician) return res.status(400).json({ message: 'No technician assigned to this booking' });

        // Retrieve platform financial figures from booking
        const platformPortion = (booking.platformFees || 0) + (booking.taxes || 0);
        const techShare = Math.max(0, (booking.technicianCharges || 0) - (booking.technicianDiscountShare || 0));
        const bookingRef = booking.bookingId || booking._id.toString();

        // Step 1: REVERSE the incorrect EARNING credit (tech does NOT get paid by platform for COD)
        await updateUniversalLedger(
            booking.assignedTechnician,
            'ADJUSTMENT',
            -techShare,   // Negative: reversing the wrong credit
            bookingRef,
            `[PAYMENT CORRECTION] Reversed incorrect EARNING for #${bookingRef}. Booking was COD (cash collected by tech), not online. Reason: ${correctedReason.trim()}`,
            {
                bookingId: booking._id,
                correctedBy: req.user.id,
                correctionType: 'EARNING_REVERSAL',
                originalPaymentMethod: booking.paymentMethod
            }
        );

        // Step 2: Apply correct COD COMMISSION (tech collected cash, owes platform its share)
        await updateUniversalLedger(
            booking.assignedTechnician,
            'COMMISSION_DEDUCTION',
            -platformPortion,   // Negative: tech owes platform
            bookingRef,
            `[PAYMENT CORRECTION] COD commission applied for #${bookingRef} after payment method correction.`,
            {
                bookingId: booking._id,
                correctedBy: req.user.id,
                correctionType: 'COD_COMMISSION_APPLIED',
                breakdown: { platformFees: booking.platformFees, taxes: booking.taxes }
            }
        );

        // Step 3: Update booking record
        booking.paymentMethod = 'COD';
        booking.paymentMethodCorrected = true;
        booking.paymentMethodCorrectedBy = req.user.id;
        booking.paymentMethodCorrectedAt = new Date();
        booking.paymentMethodCorrectionReason = correctedReason.trim();
        await booking.save();

        // Invalidate booking cache
        cache.del('dashboard_stats:role=admin&org=global');

        console.log(`✅ Payment method corrected for booking #${bookingRef} by admin ${req.user.id}`);
        res.json({
            message: `Payment method corrected for #${bookingRef}. Earning reversed (-₹${techShare}) and COD commission applied (-₹${platformPortion}).`,
            reversalAmount: techShare,
            commissionApplied: platformPortion
        });
    } catch (err) {
        console.error('Error correcting payment method:', err);
        res.status(500).json({ message: 'Failed to correct payment method' });
    }
});

// GET: Get all deleted bookings (Admin audit list)
router.get('/admin/deleted-list', verifyToken, isAdmin, async (req, res) => {
    try {
        const deletedRecords = await DeletedBooking.find()
            .populate('deletedBy', 'name phone email')
            .sort({ deletedAt: -1 })
            .lean();
        
        res.json(deletedRecords);
    } catch (err) {
        console.error('Error fetching deleted records:', err);
        res.status(500).json({ message: 'Failed to fetch deleted records' });
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

// PATCH: Start service (technician or Admin override)
router.patch('/:id/start', verifyToken, async (req, res) => {
    try {
        const isAdminOverride = ['admin', 'employee'].includes(req.user.role);
        
        if (req.user.role !== 'technician' && !isAdminOverride) {
            return res.status(403).json({ message: 'Technician access or Admin override required' });
        }

        const booking = await Booking.findById(req.params.id);

        if (!booking) {
            return res.status(404).json({ message: 'Booking not found' });
        }

        // 🛡️ LOCK
        if (['Completed', 'Cancelled'].includes(booking.status)) {
            return res.status(400).json({ message: `Cannot start a ${booking.status.toLowerCase()} booking` });
        }

        // Check if technician is assigned or is Admin acting on behalf
        const isAssigned = booking.assignedTechnician && booking.assignedTechnician.toString() === req.user.id;
        if (!isAssigned && !isAdminOverride) {
            return res.status(403).json({ message: 'You are not assigned to this booking, and no Admin override privileges detected.' });
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

// PATCH: Complete service (technician or Admin override)
router.patch('/:id/complete', verifyToken, async (req, res) => {
    try {
        const isAdminOverride = ['admin', 'employee'].includes(req.user.role);

        if (req.user.role !== 'technician' && !isAdminOverride) {
            return res.status(403).json({ message: 'Technician access or Admin override required' });
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

        // Check if technician is assigned or is Admin acting on behalf
        const isAssigned = booking.assignedTechnician && booking.assignedTechnician.toString() === req.user.id;
        if (!isAssigned && !isAdminOverride) {
             return res.status(403).json({ message: 'You are not assigned to this booking, and no Admin override privileges detected.' });
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

        // Auto-generate Invoice (will be Unpaid if COD not yet collected; stays open for payment marking)
        const invoice = await autoGenerateInvoice(booking._id);

        // 🔥 SMS & Email: Always fire on completion regardless of paymentReceived
        (async () => {
            const completedUser = await User.findById(booking.userId);
            if (completedUser) {
                // SMS
                sendServiceCompletedSms(booking.userId, completedUser.name || 'Customer', booking.bookingId).catch(o => {});
                // Email (with invoice if available)
                sendJobCompletedEmail(completedUser, booking, invoice).catch(e => console.error('[Email] tech complete email error:', e));
            }
        })();

        // Record Technician Earning only when payment is confirmed (not for pending COD)
        if (booking.paymentStatus === 'paid' || booking.paymentReceived === true) {
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

// PATCH: Generic update for technicians/admin/engineer (Web Dashboard compatibility)
router.patch('/:id/tech-update', verifyToken, async (req, res) => {
    try {
        const { status, remark, paymentReceived, paymentCollectedBy, customerBehavior, userRating } = req.body;
        const booking = await Booking.findById(req.params.id);

        if (!booking) return res.status(404).json({ message: 'Booking not found' });

        // 🛡️ LOCK — Hard block on Cancelled.
        // Completed bookings can still receive payment updates (paymentReceived) from admin/engineer/technician.
        if (booking.status === 'Cancelled') {
            return res.status(400).json({ message: 'Cannot update a cancelled booking' });
        }

        // For already-Completed bookings, only allow paymentReceived/customerBehavior/userRating updates. Block status changes.
        const isAlreadyCompleted = booking.status === 'Completed';
        if (isAlreadyCompleted && status && status !== 'Completed') {
            return res.status(400).json({ message: 'Cannot change status of a completed booking. Only payment marking is allowed.' });
        }

        // Access check: Only assigned technician, admin, or engineer
        if (req.user.role !== 'admin' && req.user.role !== 'engineer' && req.user.role !== 'employee' && booking.assignedTechnician?.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Access denied' });
        }

        if (status && !isAlreadyCompleted) booking.status = status;
        if (remark) booking.technicianNotes = remark;
        if (paymentCollectedBy) booking.paymentCollectedBy = paymentCollectedBy;
        if (paymentReceived !== undefined) {
            booking.paymentReceived = paymentReceived;
            // Sync paymentStatus for consistency
            if (paymentReceived === true) {
                booking.paymentStatus = 'paid';
            } else if (paymentReceived === false && booking.paymentStatus === 'paid') {
                booking.paymentStatus = 'unpaid';
            }
        }
        if (customerBehavior) booking.customerBehavior = customerBehavior;

        // Update User Rating if provided
        if (userRating !== undefined && userRating > 0) {
            const oldRating = booking.userRating || 0;
            booking.userRating = userRating;

            const user = await User.findById(booking.userId);
            if (user) {
                if (oldRating === 0) {
                    const newTotal = user.totalRatings + 1;
                    user.averageRating = ((user.averageRating * user.totalRatings) + userRating) / newTotal;
                    user.totalRatings = newTotal;
                } else {
                    user.averageRating = ((user.averageRating * user.totalRatings) - oldRating + userRating) / user.totalRatings;
                }
                await user.save();
            }
        }

        booking.statusHistory.push({
            status: booking.status,
            timestamp: new Date(),
            updatedBy: req.user.id,
            notes: remark || (paymentReceived === true ? `Payment marked as received${paymentCollectedBy ? ` (Collected by ${paymentCollectedBy})` : ''}` : 'Status updated via dashboard')
        });

        if (status === 'Completed' || paymentReceived === true) {
            if (status === 'Completed' && !isAlreadyCompleted) {
                booking.completedAt = new Date();

                // Notify User (push)
                await sendUserNotification(
                    booking.userId,
                    'Service Completed',
                    `Your service for booking ${booking.bookingId} has been completed. Please share your feedback!`,
                    { bookingId: booking._id.toString(), type: 'completion' }
                );
            }

            await booking.save();

            // Auto-generate or update invoice on completion or payment receipt
            if (paymentReceived === true) {
                // To ensure transparency and reflect 'Paid' status, we delete the old invoice and let helper regenerate it
                await Invoice.findOneAndDelete({ bookingId: booking._id });
            }
            const invoice = await autoGenerateInvoice(booking._id);

            if (status === 'Completed' && !isAlreadyCompleted) {
                await triggerAutomation('booking.completed', booking);

                // SMS & Email to customer
                (async () => {
                    const completedUser = await User.findById(booking.userId);
                    if (completedUser) {
                        sendServiceCompletedSms(booking.userId, completedUser.name || 'Customer', booking.bookingId).catch(o => {});
                        sendJobCompletedEmail(completedUser, booking, invoice).catch(e => console.error('[Email] Dashboard complete email error:', e));
                    }
                })();
            }

            // Record Technician Earning when payment is confirmed
            if (booking.paymentReceived === true || booking.paymentStatus === 'paid') {
                await recordTechnicianEarning(booking).catch(e => console.error('[Finance] Dashboard Earning error:', e));

                // 📜 Record Payment in Customer's Financial Ledger
                await updateUniversalLedger(
                    booking.userId,
                    'PAYMENT',
                    -booking.totalAmount, // Negative because it's an outflow for the customer
                    booking.bookingId || booking._id.toString(),
                    `Payment received for booking #${booking.bookingId} (${booking.paymentMethod || 'COD'})`,
                    { 
                        bookingId: booking._id,
                        method: booking.paymentMethod || 'COD',
                        breakdown: {
                            totalAmount: booking.totalAmount,
                            basePrice: booking.basePrice,
                            taxes: booking.taxes,
                            discount: booking.discount,
                            pointsUsed: booking.pointsUsed || 0
                        }
                    },
                    booking.isDemo || false
                ).catch(err => console.error('[Ledger] Customer COD payment log error:', err));
            }
        } else {
            await booking.save();
        }

        // 🛡️ CRITICAL FIX: Populate before returning to prevent "vanishing details" on the frontend
        await booking.populate([
            { path: 'userId', select: 'name email phone' },
            { path: 'serviceId', select: 'name category description' },
            { path: 'packageId', select: 'name price description' },
            { path: 'addressId' },
            { path: 'assignedTechnician', select: 'name phone email' },
            { path: 'organisationId', select: 'name phone email' }
        ]);

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
            if (req.user.role !== 'admin' && req.user.role !== 'engineer' && req.user.role !== 'employee') {
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
            totalCashCollected: 0,
            totalOnlineEarnings: 0,
            assignedJobs: 0,
            completedJobs: 0,
            cancelledJobs: 0,
            weeklyEarnings: [0, 0, 0, 0, 0, 0, 0] // [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
        };

        const today = new Date();
        const last7Days = new Date(today);
        last7Days.setDate(today.getDate() - 7);

        // Basic counts and Cash collection from bookings
        allJobs.forEach(job => {
            if (job.status === 'Assigned') stats.assignedJobs++;
            if (job.status === 'Completed') {
                stats.completedJobs++;
                // If COD, technician has the full cash
                if (job.paymentMethod === 'COD' || !job.paymentMethod) {
                    stats.totalCashCollected += (job.totalAmount || 0);
                }
            }
            if (job.status === 'Cancelled') stats.cancelledJobs++;
        });

        // Exact earnings from TechnicianEarning for accuracy and consistency
        const earningsRaw = await TechnicianEarning.find({ technicianId: techId, status: 'credited' }).populate('bookingId');
        
        earningsRaw.forEach(earning => {
            const amount = earning.technicianShare || 0;
            stats.totalEarnings += amount;

            // Differentiate online earnings
            const booking = earning.bookingId;
            if (booking && booking.paymentMethod !== 'COD' && booking.paymentMethod) {
                stats.totalOnlineEarnings += amount;
            }

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
            customerNotes,
            couponCode
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
            // 🛡️ Safety Validation: Prevent 500 crashes if form fails to send mandatory fields
            if (!addressDetails.street || !addressDetails.city || !addressDetails.state || !addressDetails.pincode) {
                return res.status(400).json({ message: 'Address street, city, state, and pincode are required.' });
            }

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
        let technicianCharges = servicePackage.technicianCharges || 0;
        let platformFees = servicePackage.platformFees || 0;
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
            if (!coupon.isValid(basePrice)) {
                return res.status(400).json({ message: 'Coupon has expired or is invalid for this amount' });
            }

            discount = coupon.calculateDiscount(basePrice);
            couponId = coupon._id;
            technicianAbsorbsPercent = coupon.technicianAbsorbsPercent;
        }

        // Calculate Apportionment for discount
        let technicianDiscountShare = 0;
        let platformDiscountShare = 0;

        if (discount > 0) {
            if (technicianAbsorbsPercent !== null && technicianAbsorbsPercent !== undefined) {
                technicianDiscountShare = round(discount * (technicianAbsorbsPercent / 100));
            } else {
                technicianDiscountShare = 0;
            }
            platformDiscountShare = discount - technicianDiscountShare;
        }

        const netPlatformFees = round(platformFees - platformDiscountShare);
        const taxes = round((netPlatformFees * 18) / 100);
        const totalAmount = Math.max(0, round(basePrice + taxes - discount));

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
            discount,
            couponId,
            totalAmount,
            paymentMethod: 'COD',
            status: 'Awaiting Confirmation',
            serviceOTP: otp,
            serviceOTPExpires: otpExpires,
            statusHistory: [{
                status: 'Awaiting Confirmation',
                timestamp: new Date(),
                updatedBy: req.user.id,
                notes: `Initiated by employee ${req.user.name || req.user.id}${couponCode ? ` with coupon ${couponCode.toUpperCase()}` : ''}`
            }]
        });

        await booking.save();

        // 7. Send Push Notification (New Secure Confirmation)
        if (user.fcmToken) {
            await sendUserNotification(
                user._id,
                'Verify Your Booking',
                `An employee has initiated a ${service.name} request for you. Please confirm it in the app.`,
                {
                    type: 'booking_confirmation',
                    bookingId: booking._id.toString(),
                    displayId: booking.bookingId,
                    click_action: 'FLUTTER_NOTIFICATION_CLICK'
                }
            );
        }

        // 8. Send SMS (Fallback/Existing)
        sendServiceRequestOTPSms(user.phone, otp).catch(e => console.error('[SMS] Service OTP error:', e));
        if (user.email) {
            sendServiceRequestOTPEmail(user, otp).catch(e => console.error('[Email] Service OTP error:', e));
        }

        res.status(201).json({
            message: 'Service request initiated. Please confirm via App or OTP.',
            bookingId: booking._id,
            displayId: booking.bookingId,
            isNewUser,
            notificationSent: !!user.fcmToken
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
 * PATCH: Confirm employee-initiated request (Push/In-app)
 * Authenticated for the user who owns the booking
 */
router.patch('/:id/user-confirm', verifyToken, async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.status(404).json({ message: 'Booking not found' });

        // Security check
        if (booking.userId.toString() !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Unauthorized to confirm this booking' });
        }

        if (booking.status !== 'Awaiting Confirmation') {
            return res.status(400).json({ message: 'Booking is not in awaiting confirmation state' });
        }

        // Clear OTP and update status
        booking.serviceOTP = undefined;
        booking.serviceOTPExpires = undefined;
        const nextStatus = booking.isDemo ? 'Assigned' : 'Pending';
        booking.status = nextStatus;
        booking.statusHistory.push({
            status: nextStatus,
            timestamp: new Date(),
            updatedBy: req.user.id,
            notes: 'User verified via App/Secure link. Booking confirmed.'
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
            status: booking.status
        });

    } catch (err) {
        console.error('User confirm error:', err);
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
        res.status(500).json({ message: err.message || 'Failed to create demo booking' });
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

        const upiId = (process.env.CENTRAL_UPI_ID || 'boim-755829220145@boi').trim();
        const upiName = encodeURIComponent((process.env.CENTRAL_UPI_NAME || 'WATTORBIT ENERGY SOLUTIONS LLP').trim());
        const amount = booking.totalAmount.toFixed(2);
        const transactionNote = encodeURIComponent(`Payment for Booking ${booking.bookingId}`);
        const tr = encodeURIComponent(booking.bookingId);
        
        // Standard UPI Dynamic URI Scheme
        const upiURI = `upi://pay?pa=${upiId}&pn=${upiName}&am=${amount}&tn=${transactionNote}&tr=${tr}&mc=0000&mode=02&purpose=00&orgid=000000&cu=INR`;

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
 * POST: Finalize and Confirm Payment (Manual UPI / COD confirmation by Technician, Admin, or Engineer)
 * Works on both active (In Progress) and already-Completed bookings where payment is still pending.
 */
router.post('/:id/confirm-payment', verifyToken, async (req, res) => {
    try {
        const { paymentId, notes } = req.body;
        const booking = await Booking.findById(req.params.id);

        if (!booking) return res.status(404).json({ message: 'Booking not found' });
        
        // 🛡️ LOCK — Hard block only on Cancelled
        if (booking.status === 'Cancelled') {
            return res.status(400).json({ message: 'Cannot confirm payment for a cancelled booking' });
        }

        // Also block if payment is already confirmed
        if (booking.paymentReceived === true) {
            return res.status(400).json({ message: 'Payment has already been confirmed for this booking' });
        }
        
        // Only assigned technician, admin, or engineer can confirm
        if (req.user.role !== 'admin' && req.user.role !== 'engineer' && booking.assignedTechnician?.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Unauthorized' });
        }

        const wasAlreadyCompleted = booking.status === 'Completed';

        booking.paymentStatus = 'paid';
        booking.paymentId = paymentId;
        booking.paymentReceived = true;
        
        // Only transition to Completed if not already there
        if (!wasAlreadyCompleted) {
            booking.status = 'Completed';
            booking.completedAt = new Date();
        }
        
        booking.statusHistory.push({
            status: booking.status,
            timestamp: new Date(),
            updatedBy: req.user.id,
            notes: notes || `Payment confirmed. TrxID: ${paymentId || 'COD'}`
        });

        await booking.save();

        // Auto-generate or update invoice — will now have paymentStatus: 'Paid'
        // 🛡️ REVISION: Do not delete invoices when payment is received. 
        // Instead, the autoGenerateInvoice helper will update the existing invoice's paymentStatus.
        // This ensures the Invoice ID remains stable for audit purposes.
        const invoice = await autoGenerateInvoice(booking._id);

        // Push notifications
        sendUserNotification(
            booking.userId,
            wasAlreadyCompleted ? 'Payment Received' : 'Service Completed',
            wasAlreadyCompleted
                ? `Payment for booking ${booking.bookingId} has been confirmed. Thank you!`
                : `Your service for booking ${booking.bookingId} is complete. Payment received!`,
            { bookingId: booking._id.toString(), type: 'payment_confirmed' }
        ).catch(e => console.error('[Push] payment confirm user error:', e));

        sendTopicNotification(
            'admin',
            'Payment Confirmed',
            `Payment confirmed for booking ${booking.bookingId}.`,
            { bookingId: booking._id.toString(), type: 'payment_confirmed' }
        ).catch(e => console.error('[Push] payment confirm admin error:', e));

        // SMS & Email to customer
        (async () => {
            const completedUser = await User.findById(booking.userId);
            if (completedUser) {
                sendServiceCompletedSms(booking.userId, completedUser.name || 'Customer', booking.bookingId).catch(o => {});
                sendJobCompletedEmail(completedUser, booking, invoice).catch(e => console.error('[Email] confirm-payment email error:', e));
            }
        })();

        // Record Technician Earning now that payment is confirmed
        await recordTechnicianEarning(booking).catch(e => console.error('[Finance] confirm-payment earning error:', e));

        res.json({ message: 'Payment confirmed successfully', booking, invoice: invoice ? { invoiceId: invoice.invoiceId } : null });

    } catch (err) {
        console.error('[confirm-payment] error:', err);
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
        
        // 🛡️ LOCK — Hard block only on Cancelled.
        // Completed bookings CAN still receive photos (technician may upload after marking done, admin adds evidence)
        if (booking.status === 'Cancelled') {
            return res.status(400).json({ message: 'Cannot upload photos to a cancelled booking' });
        }
        
        // Authorization: Assigned Technician, Admin, Employee, or Engineer, OR Booking Owner (for problem photos)
        const isAssigned = booking.assignedTechnician?.toString() === req.user.id;
        const isPrivileged = ['admin', 'employee', 'engineer'].includes(req.user.role);
        const isOwner = booking.userId?.toString() === req.user.id;

        if (!isPrivileged && !isAssigned && !(isOwner && stage === 'problem')) {
            return res.status(403).json({ message: 'Unauthorized to upload photos' });
        }

        if (!['problem', 'start', 'progress', 'completion'].includes(stage)) {
            return res.status(400).json({ message: 'Invalid stage. Must be problem, start, progress, or completion' });
        }

        if (!req.file) {
            return res.status(400).json({ message: 'No image file provided' });
        }

        // Limit check
        const currentPhotos = booking.jobPhotos[stage] || [];
        if (currentPhotos.length >= 3) {
            return res.status(400).json({ message: `Maximum 3 photos allowed for ${stage} stage` });
        }

        // 🔆 Photo Sequencing Rules — enforced for active jobs; waived for privileged users on completed bookings
        const isCompleted = booking.status === 'Completed';
        if ((!isCompleted || !isPrivileged) && stage !== 'problem') {
            if (stage === 'progress' && (!booking.jobPhotos.start || booking.jobPhotos.start.length === 0)) {
                return res.status(400).json({ message: 'Must upload "Start" photos before "Progress" photos' });
            }
            if (stage === 'completion' && (!booking.jobPhotos.progress || booking.jobPhotos.progress.length === 0)) {
                return res.status(400).json({ message: 'Must upload "Progress" photos before "Completion" photos' });
            }
        }

        // Upload to Cloudinary
        const { url } = await uploadToCloudinary(req.file.path, `wattorbit/bookings/${booking.bookingId}/${stage}`);
        
        // Cleanup temp file
        fs.unlinkSync(req.file.path);

        // Update Booking
        booking.jobPhotos[stage].push(url);
        
        // 🔄 Auto-transition status based on photo stage (only while booking is still active)
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

/* =====================
   MATERIAL / SPARES MANAGEMENT
===================== */

// POST: Add material to a booking (Technician or Manage roles)
router.patch('/:id/add-material', verifyToken, async (req, res) => {
    try {
        const { materialId, quantity } = req.body;
        if (!materialId || !quantity) {
            return res.status(400).json({ message: 'materialId and quantity are required' });
        }

        const Material = require('../models/Material');
        const material = await Material.findById(materialId);
        if (!material || !material.isActive) {
            return res.status(404).json({ message: 'Material not found or inactive' });
        }

        const qty = Number(quantity);

        // 🛡️ Stock check
        if (material.stockQuantity < qty) {
            return res.status(400).json({ 
                message: `Insufficient stock. Available: ${material.stockQuantity} ${material.unit}(s), Requested: ${qty}` 
            });
        }

        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.status(404).json({ message: 'Booking not found' });

        // Authorization: Only assigned tech or management roles
        const canEdit = req.user.role === 'admin' || req.user.role === 'employee' || 
                        (req.user.role === 'technician' && booking.assignedTechnician?.toString() === req.user.id);
        
        if (!canEdit) return res.status(403).json({ message: 'Access denied' });
        if (['Completed', 'Cancelled'].includes(booking.status)) {
            return res.status(400).json({ message: 'Cannot add materials to completed or cancelled bookings' });
        }

        // Calculate snapshots
        const sellingPrice = material.sellingPrice;
        const sellingTaxRate = material.sellingTaxRate;
        const sellingTaxAmount = Math.round((sellingPrice * sellingTaxRate) / 100);
        const lineTaxAmount = sellingTaxAmount * qty;
        const totalLineAmount = qty * sellingPrice + lineTaxAmount;

        // Add to array
        booking.materialsUsed.push({
            materialId: material._id,
            name: material.name,
            make: material.make,
            hsnCode: material.hsnCode,
            quantity: qty,
            purchasePrice: material.purchasePrice,
            purchaseTaxRate: material.purchaseTaxRate,
            purchaseTaxAmount: material.purchaseTaxAmount,
            sellingPrice,
            sellingTaxRate,
            sellingTaxAmount,
            lineTaxAmount,
            totalLineAmount
        });

        // 📦 Decrement stock
        material.stockQuantity = Math.max(0, material.stockQuantity - qty);
        await material.save();

        // Recalculate totals
        let materialTotal = 0;
        let materialTaxTotal = 0;
        booking.materialsUsed.forEach(m => {
            materialTotal += (m.sellingPrice * m.quantity);
            materialTaxTotal += (m.sellingTaxAmount * m.quantity);
        });

        booking.materialTotal = materialTotal;
        booking.materialTaxTotal = materialTaxTotal;
        
        // Recalculate Grand Total
        booking.totalAmount = Math.max(0, booking.basePrice + booking.taxes + materialTotal + materialTaxTotal - (booking.discount || 0) - (booking.pointsUsed || 0));

        await booking.save();
        res.json({ message: 'Material added', booking });
    } catch (err) {
        res.status(500).json({ message: 'Error adding material', error: err.message });
    }
});

// DELETE: Remove material from booking
router.delete('/:id/remove-material/:lineItemId', verifyToken, async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.status(404).json({ message: 'Booking not found' });

        const canEdit = req.user.role === 'admin' || req.user.role === 'employee' || 
                        (req.user.role === 'technician' && booking.assignedTechnician?.toString() === req.user.id);
        
        if (!canEdit) return res.status(403).json({ message: 'Access denied' });
        if (['Completed', 'Cancelled'].includes(booking.status)) {
            return res.status(400).json({ message: 'Cannot remove materials from completed or cancelled bookings' });
        }

        // 📦 Find the line item to restore stock before removing
        const removedItem = booking.materialsUsed.find(m => m._id.toString() === req.params.lineItemId);
        if (removedItem && removedItem.materialId) {
            const Material = require('../models/Material');
            await Material.findByIdAndUpdate(removedItem.materialId, {
                $inc: { stockQuantity: removedItem.quantity }
            });
        }

        booking.materialsUsed = booking.materialsUsed.filter(m => m._id.toString() !== req.params.lineItemId);

        // Recalculate totals
        let materialTotal = 0;
        let materialTaxTotal = 0;
        booking.materialsUsed.forEach(m => {
            materialTotal += (m.sellingPrice * m.quantity);
            materialTaxTotal += (m.sellingTaxAmount * m.quantity);
        });

        booking.materialTotal = materialTotal;
        booking.materialTaxTotal = materialTaxTotal;
        booking.totalAmount = Math.max(0, booking.basePrice + booking.taxes + materialTotal + materialTaxTotal - (booking.discount || 0) - (booking.pointsUsed || 0));

        await booking.save();
        res.json({ message: 'Material removed', booking });
    } catch (err) {
        res.status(500).json({ message: 'Error removing material', error: err.message });
    }
});

module.exports = router;
