const express = require('express');
const router = express.Router();
const Feedback = require('../models/Feedback');
const Booking = require('../models/Booking');
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

// POST: Submit feedback for booking
router.post('/', verifyToken, async (req, res) => {
    try {
        const {
            bookingId,
            serviceRating,
            technicianRating,
            overallRating,
            review,
            punctuality,
            professionalism,
            quality,
            wouldRecommend,
            images
        } = req.body;

        // Validation
        if (!bookingId || !serviceRating || !overallRating) {
            return res.status(400).json({
                message: 'Missing required fields: bookingId, serviceRating, overallRating'
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

        // Check if booking is completed
        if (booking.status !== 'Completed') {
            return res.status(400).json({ message: 'Can only submit feedback for completed bookings' });
        }

        // Check if feedback already exists
        const existingFeedback = await Feedback.findOne({ bookingId });
        if (existingFeedback) {
            return res.status(400).json({ message: 'Feedback already submitted for this booking' });
        }

        const feedback = new Feedback({
            bookingId,
            userId: req.user.id,
            serviceId: booking.serviceId,
            technicianId: booking.assignedTechnician,
            serviceRating,
            technicianRating,
            overallRating,
            review,
            punctuality,
            professionalism,
            quality,
            wouldRecommend: wouldRecommend !== undefined ? wouldRecommend : true,
            images: images || []
        });

        await feedback.save();

        // Trigger automation hook
        await triggerAutomation('feedback.submitted', feedback);

        res.status(201).json({
            message: 'Feedback submitted successfully',
            feedback
        });
    } catch (err) {
        console.error('Error submitting feedback:', err);
        res.status(500).json({ message: 'Failed to submit feedback' });
    }
});

// GET: Get feedback for booking
router.get('/booking/:bookingId', verifyToken, async (req, res) => {
    try {
        const feedback = await Feedback.findOne({ bookingId: req.params.bookingId })
            .populate('userId', 'name')
            .populate('serviceId', 'name')
            .populate('technicianId', 'name');

        if (!feedback) {
            return res.status(404).json({ message: 'Feedback not found for this booking' });
        }

        res.json(feedback);
    } catch (err) {
        console.error('Error fetching feedback:', err);
        res.status(500).json({ message: 'Failed to fetch feedback' });
    }
});

// GET: Get all feedback for a service (published only)
router.get('/service/:serviceId', async (req, res) => {
    try {
        const { limit = 10, page = 1 } = req.query;

        const feedback = await Feedback.find({
            serviceId: req.params.serviceId,
            isPublished: true
        })
            .populate('userId', 'name')
            .populate('technicianId', 'name')
            .sort({ overallRating: -1, createdAt: -1 })
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit));

        const total = await Feedback.countDocuments({
            serviceId: req.params.serviceId,
            isPublished: true
        });

        // Calculate average ratings
        const avgRatings = await Feedback.aggregate([
            {
                $match: {
                    serviceId: require('mongoose').Types.ObjectId(req.params.serviceId),
                    isPublished: true
                }
            },
            {
                $group: {
                    _id: null,
                    avgServiceRating: { $avg: '$serviceRating' },
                    avgOverallRating: { $avg: '$overallRating' },
                    avgPunctuality: { $avg: '$punctuality' },
                    avgProfessionalism: { $avg: '$professionalism' },
                    avgQuality: { $avg: '$quality' }
                }
            }
        ]);

        res.json({
            feedback,
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            averages: avgRatings[0] || {}
        });
    } catch (err) {
        console.error('Error fetching service feedback:', err);
        res.status(500).json({ message: 'Failed to fetch feedback' });
    }
});

// GET: Get technician ratings
router.get('/technician/:technicianId', async (req, res) => {
    try {
        const feedback = await Feedback.find({
            technicianId: req.params.technicianId,
            isPublished: true
        })
            .populate('userId', 'name')
            .populate('serviceId', 'name')
            .sort({ createdAt: -1 })
            .limit(20);

        // Calculate average ratings
        const avgRatings = await Feedback.aggregate([
            {
                $match: {
                    technicianId: require('mongoose').Types.ObjectId(req.params.technicianId),
                    isPublished: true
                }
            },
            {
                $group: {
                    _id: null,
                    avgTechnicianRating: { $avg: '$technicianRating' },
                    avgPunctuality: { $avg: '$punctuality' },
                    avgProfessionalism: { $avg: '$professionalism' },
                    avgQuality: { $avg: '$quality' },
                    totalReviews: { $sum: 1 }
                }
            }
        ]);

        res.json({
            feedback,
            averages: avgRatings[0] || {}
        });
    } catch (err) {
        console.error('Error fetching technician feedback:', err);
        res.status(500).json({ message: 'Failed to fetch feedback' });
    }
});

// PATCH: Publish/unpublish feedback (admin only)
router.patch('/:id/publish', verifyToken, isAdmin, async (req, res) => {
    try {
        const { isPublished } = req.body;

        const feedback = await Feedback.findById(req.params.id);

        if (!feedback) {
            return res.status(404).json({ message: 'Feedback not found' });
        }

        feedback.isPublished = isPublished !== undefined ? isPublished : !feedback.isPublished;
        await feedback.save();

        res.json({
            message: `Feedback ${feedback.isPublished ? 'published' : 'unpublished'} successfully`,
            feedback
        });
    } catch (err) {
        console.error('Error publishing feedback:', err);
        res.status(500).json({ message: 'Failed to publish feedback' });
    }
});

// POST: Admin response to feedback (admin only)
router.post('/:id/respond', verifyToken, isAdmin, async (req, res) => {
    try {
        const { adminResponse } = req.body;

        if (!adminResponse) {
            return res.status(400).json({ message: 'Admin response required' });
        }

        const feedback = await Feedback.findById(req.params.id);

        if (!feedback) {
            return res.status(404).json({ message: 'Feedback not found' });
        }

        feedback.adminResponse = adminResponse;
        feedback.isVerified = true;
        await feedback.save();

        res.json({
            message: 'Admin response added successfully',
            feedback
        });
    } catch (err) {
        console.error('Error adding admin response:', err);
        res.status(500).json({ message: 'Failed to add admin response' });
    }
});

module.exports = router;
