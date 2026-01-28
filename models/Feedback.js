const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
    bookingId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking',
        required: true,
        unique: true // One feedback per booking
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    serviceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Service',
        required: true
    },
    technicianId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },

    // Ratings (1-5 scale)
    serviceRating: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    },
    technicianRating: {
        type: Number,
        min: 1,
        max: 5
    },
    overallRating: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    },

    // Reviews
    review: {
        type: String,
        trim: true,
        maxlength: 1000
    },

    // Specific feedback
    punctuality: {
        type: Number,
        min: 1,
        max: 5
    },
    professionalism: {
        type: Number,
        min: 1,
        max: 5
    },
    quality: {
        type: Number,
        min: 1,
        max: 5
    },

    // Additional
    wouldRecommend: {
        type: Boolean,
        default: true
    },
    images: [{
        type: String // URLs for before/after photos
    }],

    // Moderation
    isPublished: {
        type: Boolean,
        default: true
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    adminResponse: {
        type: String,
        trim: true
    },

    submittedAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

// Indexes for efficient queries

feedbackSchema.index({ serviceId: 1, isPublished: 1 });
feedbackSchema.index({ technicianId: 1 });
feedbackSchema.index({ overallRating: -1 });

module.exports = mongoose.model('Feedback', feedbackSchema);
