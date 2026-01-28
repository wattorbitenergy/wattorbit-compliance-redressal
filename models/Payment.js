const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    paymentId: {
        type: String,
        required: true,
        unique: true
    },
    bookingId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking',
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    amount: {
        type: Number,
        required: true,
        min: 0
    },
    paymentMethod: {
        type: String,
        enum: ['COD', 'Online', 'Card', 'UPI', 'Wallet'],
        default: 'COD'
    },

    status: {
        type: String,
        enum: ['Pending', 'Paid', 'Failed', 'Refunded'],
        default: 'Pending'
    },

    // COD specific
    codCollectedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    codCollectedAt: {
        type: Date
    },

    // Online payment specific
    transactionId: {
        type: String,
        trim: true
    },
    gatewayResponse: {
        type: mongoose.Schema.Types.Mixed
    },

    // Refund details
    refundAmount: {
        type: Number,
        min: 0,
        default: 0
    },
    refundReason: {
        type: String,
        trim: true
    },
    refundedAt: {
        type: Date
    },

    // Payment tracking
    paymentHistory: [{
        action: {
            type: String,
            enum: ['initiated', 'paid', 'failed', 'refunded']
        },
        timestamp: {
            type: Date,
            default: Date.now
        },
        amount: Number,
        notes: String
    }]
}, { timestamps: true });

// Indexes for efficient queries
paymentSchema.index({ bookingId: 1 });
paymentSchema.index({ userId: 1, status: 1 });
paymentSchema.index({ status: 1, createdAt: -1 });

// Add to payment history on status change
paymentSchema.pre('save', function (next) {
    if (this.isModified('status')) {
        this.paymentHistory.push({
            action: this.status.toLowerCase(),
            timestamp: new Date(),
            amount: this.amount
        });
    }
    next();
});

module.exports = mongoose.model('Payment', paymentSchema);
