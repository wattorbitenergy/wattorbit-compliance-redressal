const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Service = require('../models/Service');
const ServicePackage = require('../models/ServicePackage');
const Address = require('../models/Address');
const User = require('../models/User');
const Coupon = require('../models/Coupon');
const { generateBookingId } = require('../utils/idGenerator');
const { triggerAutomation } = require('../utils/automationEngine');
const { sendUserNotification, sendTopicNotification } = require('../utils/notificationHelper');
const { autoGenerateInvoice } = require('../utils/invoiceHelper');
const { 
    sendBookingCreatedSms, 
    sendTechnicianAssignedSms, 
    sendJobAssignedToTechnicianSms, 
    sendServiceCompletedSms,
    sendServiceRequestOTPSms // 🆕
} = require('../utils/smsHelper'); 
const cache = require('../utils/cache');
const { 
    sendBookingCreatedEmail, 
    sendTechnicianAssignedEmail, 
    sendJobCompletedEmail,
    sendServiceRequestOTPEmail // 🆕
} = require('../utils/emailHelper');
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
        const technicianCharges = servicePackage.technicianCharges || 0;
        const platformFees = servicePackage.platformFees || 0;
        const taxRate = 18; // 18% GST on platform fees only
        const taxes = Math.round((platformFees * taxRate) / 100);

        // Base price for discounts is the total of components
        const basePrice = technicianCharges + platformFees;

        // Apply coupon if provided
        let discount = 0;
        let couponId = null;

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
        }

        // Apply package discount if no coupon discount (or as fallback)
        // Note: Deciding that coupons take precedence and are not additive by default unless specified
        if (discount === 0 && servicePackage.discount && servicePackage.discount.percentage > 0) {
            if (!servicePackage.discount.validUntil || new Date(servicePackage.discount.validUntil) >= new Date()) {
                discount = Math.round((basePrice * servicePackage.discount.percentage) / 100);
            }
        }

        const totalAmount = Math.max(0, basePrice + taxes - discount - pointsToUse);

        // For Online payments: defer bookingId generation until payment is verified.
        // For COD/Wallet: generate bookingId immediately.
        const isOnlinePayment = paymentMethod === 'Online';
        const bookingId = isOnlinePayment ? null : await generateBookingId();

        const booking = new Booking({
            bookingId,
            userId: req.user.id,
            organisationId, // Capture Org context
            serviceId,
            packageId,
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
            pointsUsed: pointsToUse,
            totalAmount,
            paymentMethod: paymentMethod || 'COD',
            status: 'Pending',
            statusHistory: [{
                status: 'Pending',
                timestamp: new Date(),
                updatedBy: req.user.id,
                notes: isOnlinePayment ? 'Booking initiated (Awaiting Payment)' : 'Booking created'
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

        // Trigger automation hook
        await triggerAutomation('booking.cancelled', booking);

        // Notify Admin
        await sendTopicNotification(
            'admin',
            'Booking Cancelled',
            `Booking ${booking.bookingId} has been cancelled by ${req.user.name}.`,
            { bookingId: booking._id.toString(), type: 'cancellation' }
        );

        // Notify Technician if assigned
        if (booking.assignedTechnician) {
            await sendUserNotification(
                booking.assignedTechnician,
                'Assignment Cancelled',
                `Booking ${booking.bookingId} has been cancelled.`,
                { bookingId: booking._id.toString(), type: 'cancellation' }
            );
        }

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

        // Check if technician is assigned to this booking
        if (!booking.assignedTechnician || booking.assignedTechnician.toString() !== req.user.id) {
            return res.status(403).json({ message: 'You are not assigned to this booking' });
        }

        if (booking.status !== 'Assigned') {
            return res.status(400).json({ message: 'Booking must be in Assigned status to start' });
        }

        booking.status = 'In Progress';
        booking.statusHistory.push({
            status: 'In Progress',
            timestamp: new Date(),
            updatedBy: req.user.id,
            notes: 'Service started by technician'
        });

        await booking.save();

        // Trigger automation hook
        await triggerAutomation('booking.in_progress', booking);

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
        const technician = await User.findById(techId).select('name availabilityStatus');
        if (!technician) return res.status(404).json({ message: 'Technician not found' });

        // Fetch all jobs for basic counts
        const allJobs = await Booking.find({ assignedTechnician: techId });

        const stats = {
            technicianName: technician.name,
            availabilityStatus: technician.availabilityStatus,
            totalEarnings: 0,
            assignedJobs: 0,
            completedJobs: 0,
            cancelledJobs: 0,
            weeklyEarnings: [0, 0, 0, 0, 0, 0, 0] // [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
        };

        const today = new Date();
        const last7Days = new Date(today);
        last7Days.setDate(today.getDate() - 7);

        allJobs.forEach(job => {
            if (job.status === 'Assigned') stats.assignedJobs++;
            if (job.status === 'Completed') {
                stats.completedJobs++;
                const earnings = job.technicianCharges || 0;
                stats.totalEarnings += earnings;

                // Simple weekly grouping (0 = Sunday, but we want Mon-Sun for the UI graph later)
                if (job.completedAt >= last7Days) {
                    const day = job.completedAt.getDay(); // 0 is Sunday, 1 is Monday...
                    const index = day === 0 ? 6 : day - 1; // Map to 0-6 starting Monday
                    stats.weeklyEarnings[index] += earnings;
                }
            }
            if (job.status === 'Cancelled') stats.cancelledJobs++;
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
                walletBalance: 100 // Welcome Bonus
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
        booking.status = 'Pending';
        booking.statusHistory.push({
            status: 'Pending',
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

module.exports = router;
