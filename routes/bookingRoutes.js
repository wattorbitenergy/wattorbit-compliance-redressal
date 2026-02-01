const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Service = require('../models/Service');
const ServicePackage = require('../models/ServicePackage');
const Address = require('../models/Address');
const User = require('../models/User');
const { generateBookingId } = require('../utils/idGenerator');
const { triggerAutomation } = require('../utils/automationEngine');
const { sendUserNotification } = require('../utils/notificationHelper');
const { autoGenerateInvoice } = require('../utils/invoiceHelper');
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
    const roles = ['admin', 'engineer', 'organisation'];
    if (!roles.includes(req.user.role)) {
        return res.status(403).json({ message: 'Access denied: Requires Admin, Engineer, or Partner role' });
    }
    next();
};

// Admin or Engineer check middleware
const isAdminOrEngineer = (req, res, next) => {
    if (req.user.role !== 'admin' && req.user.role !== 'engineer') {
        return res.status(403).json({ message: 'Admin or Engineer access required' });
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
            customerNotes
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

        // Calculate pricing
        const basePrice = servicePackage.price;
        const taxRate = 18; // 18% GST
        const taxes = (basePrice * taxRate) / 100;

        // Apply discount if valid
        let discount = 0;
        if (servicePackage.discount && servicePackage.discount.percentage > 0) {
            if (!servicePackage.discount.validUntil || new Date(servicePackage.discount.validUntil) >= new Date()) {
                discount = (basePrice * servicePackage.discount.percentage) / 100;
            }
        }

        const totalAmount = basePrice + taxes - discount;

        // Fetch user to get organisationId
        const user = await User.findById(req.user.id);
        const organisationId = user?.organisationId || null;

        const bookingId = await generateBookingId();

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
            taxes,
            discount,
            totalAmount,
            status: 'Pending',
            statusHistory: [{
                status: 'Pending',
                timestamp: new Date(),
                updatedBy: req.user.id,
                notes: 'Booking created'
            }]
        });

        await booking.save();

        // Trigger automation hook
        await triggerAutomation('booking.created', booking);

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
            .sort({ createdAt: -1 });

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

        // Search by bookingId OR user phone number
        const bookings = await Booking.find({
            $or: [
                { bookingId: query },
                {
                    userId: {
                        $in: await User.find({
                            phone: { $regex: query, $options: 'i' }
                        }).distinct('_id')
                    }
                }
            ]
        })
            .populate('serviceId', 'name category')
            .populate('addressId', 'city street pincode')
            .populate('assignedTechnician', 'name phone')
            .sort({ createdAt: -1 });

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
        const isAdminUser = req.user.role === 'admin';
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

        // Check if user owns the booking or is admin
        if (booking.userId.toString() !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Check if booking can be cancelled
        if (['Completed', 'Cancelled'].includes(booking.status)) {
            return res.status(400).json({ message: 'Cannot cancel completed or already cancelled booking' });
        }

        booking.status = 'Cancelled';
        booking.cancellationReason = cancellationReason;
        booking.statusHistory.push({
            status: 'Cancelled',
            timestamp: new Date(),
            updatedBy: req.user.id,
            notes: cancellationReason
        });

        await booking.save();

        // Trigger automation hook
        await triggerAutomation('booking.cancelled', booking);

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
            .sort({ createdAt: -1 });

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

        booking.status = 'Confirmed';
        booking.statusHistory.push({
            status: 'Confirmed',
            timestamp: new Date(),
            updatedBy: req.user.id,
            notes: 'Booking confirmed by admin'
        });

        await booking.save();

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

        // Direct Notification to User
        await sendUserNotification(
            booking.userId,
            'Technician Assigned',
            `Technician ${technician.name} has been assigned to your booking ${booking.bookingId}.`,
            { bookingId: booking._id.toString(), type: 'assignment' }
        );

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
            }
        }

        res.json({ message: 'Booking status updated successfully', booking });
    } catch (err) {
        console.error('Error updating booking status:', err);
        res.status(500).json({ message: 'Failed to update booking status' });
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

        // Auto-generate Invoice directly to ensure it exists for download
        await autoGenerateInvoice(booking._id);

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
        const { status, remark, paymentReceived, customerBehavior } = req.body;
        const booking = await Booking.findById(req.params.id);

        if (!booking) return res.status(404).json({ message: 'Booking not found' });

        // Access check: Only assigned technician or admin
        if (req.user.role !== 'admin' && booking.assignedTechnician?.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Access denied' });
        }

        if (status) booking.status = status;
        if (remark) booking.technicianNotes = remark;
        if (paymentReceived !== undefined) booking.paymentReceived = paymentReceived;
        if (customerBehavior) booking.customerBehavior = customerBehavior;

        booking.statusHistory.push({
            status: status || booking.status,
            timestamp: new Date(),
            updatedBy: req.user.id,
            notes: remark || 'Status updated via dashboard'
        });

        if (status === 'Completed') {
            booking.completedAt = new Date();
            await booking.save();

            // Notify User
            await sendUserNotification(
                booking.userId,
                'Service Completed',
                `Your service for booking ${booking.bookingId} has been completed. Please share your feedback!`,
                { bookingId: booking._id.toString(), type: 'completion' }
            );

            // Auto-generate Invoice directly to ensure it exists for download
            await autoGenerateInvoice(booking._id);

            // Trigger completion automations (notifications etc)
            await triggerAutomation('booking.completed', booking);
            console.log(`Booking ${booking.bookingId} completion notified`);
        } else {
            await booking.save();
        }

        res.json({ message: 'Booking updated successfully', booking });
    } catch (err) {
        console.error('Tech update error:', err);
        res.status(500).json({ message: 'Failed to update booking' });
    }
});

module.exports = router;
