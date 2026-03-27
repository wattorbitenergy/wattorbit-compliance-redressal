const mongoose = require('mongoose');

const technicianEarningSchema = new mongoose.Schema({
    technicianId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    bookingId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking',
        required: true
    },
    // Financial Breakdown
    totalAmount: {
        type: Number,
        required: true,
        comment: "Grand total paid by customer"
    },
    technicianShare: {
        type: Number,
        required: true,
        comment: "Net earning for the technician"
    },
    platformFee: {
        type: Number,
        required: true,
        comment: "WattOrbit platform commission"
    },
    taxAmount: {
        type: Number,
        required: true,
        comment: "GST amount included in platform fee"
    },
    status: {
        type: String,
        enum: ['pending', 'credited', 'cancelled'],
        default: 'pending'
    },
    isDemo: {
        type: Boolean,
        default: false
    },
    notes: String
}, { timestamps: true });

// Ensure unique earning record per booking
technicianEarningSchema.index({ bookingId: 1 }, { unique: true });
technicianEarningSchema.index({ technicianId: 1, status: 1 });

module.exports = mongoose.model('TechnicianEarning', technicianEarningSchema);
