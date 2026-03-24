const mongoose = require('mongoose');

const redemptionRequestSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: 1
    },
    upiId: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    adminNotes: String,
    processedAt: Date,
    processedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    transactionId: String // External UPI transaction ID or similar
}, { timestamps: true });

redemptionRequestSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model('RedemptionRequest', redemptionRequestSchema);
