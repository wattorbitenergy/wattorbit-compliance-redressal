const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Service = require('../models/Service');
const ServicePackage = require('../models/ServicePackage');
const Address = require('../models/Address');
const User = require('../models/User');
const { generateBookingId } = require('../utils/idGenerator');
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

        const bookingId = await generateBookingId();

        const booking = new Booking({
            bookingId,
            userId: req.user.id,
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

        let query = { userId: req.user.id };

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

// GET: Get booking details
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id)
            .populate('userId', 'name phone email')
            .populate('serviceId', 'name category description images')
            .populate('packageId', 'name price features')
            .populate('addressId')
            .populate('assignedTechnician', 'name phone email');

        if (!booking) {
            return res.status(404).json({ message: 'Booking not found' });
        }

        // Check access: user can see their own, admin can see all, technician can see assigned
        if (
            booking.userId._id.toString() !== req.user.id &&
            req.user.role !== 'admin' &&
            (!booking.assignedTechnician || booking.assignedTechnician._id.toString() !== req.user.id)
        ) {
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

// GET: Get all bookings with filters (admin only)
router.get('/admin/all', verifyToken, isAdmin, async (req, res) => {
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

// PATCH: Confirm booking (admin only)
router.patch('/:id/confirm', verifyToken, isAdmin, async (req, res) => {
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

// PATCH: Assign technician (admin only)
router.patch('/:id/assign', verifyToken, isAdmin, async (req, res) => {
    try {
        const { technicianId } = req.body;

        if (!technicianId) {
            return res.status(400).json({ message: 'Technician ID required' });
        }

        // Verify technician exists and has correct role
        const technician = await User.findById(technicianId);
        if (!technician || technician.role !== 'technician') {
            return res.status(404).json({ message: 'Technician not found' });
        }

        const booking = await Booking.findById(req.params.id);

        if (!booking) {
            return res.status(404).json({ message: 'Booking not found' });
        }

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

        res.json({ message: 'Technician assigned successfully', booking });
    } catch (err) {
        console.error('Error assigning technician:', err);
        res.status(500).json({ message: 'Failed to assign technician' });
    }
});

// PATCH: Update booking status (admin only)
router.patch('/:id/status', verifyToken, isAdmin, async (req, res) => {
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

        res.json({ message: 'Service completed successfully', booking });
    } catch (err) {
        console.error('Error completing service:', err);
        res.status(500).json({ message: 'Failed to complete service' });
    }
});

module.exports = router;
