const mongoose = require('mongoose');

const deletedBookingSchema = new mongoose.Schema({
    originalBooking: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    deletionReason: {
        type: String,
        required: true,
        trim: true
    },
    deletedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    deletedAt: {
        type: Date,
        default: Date.now
    },
    bookingId: {
        type: String, // Keeping a flattened reference for easy searching
        required: true
    }
}, { timestamps: true });

deletedBookingSchema.index({ bookingId: 1 });
deletedBookingSchema.index({ deletedAt: -1 });

module.exports = mongoose.model('DeletedBooking', deletedBookingSchema);
