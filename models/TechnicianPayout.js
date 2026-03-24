const mongoose = require('mongoose');

const technicianPayoutSchema = new mongoose.Schema({
    technicianId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: 1
    },
    payoutMethod: {
        type: String,
        enum: ['UPI', 'Bank Transfer', 'Cash', 'Wallet'],
        default: 'UPI'
    },
    transactionId: {
        type: String,
        required: true,
        unique: true,
        comment: "Bank/UPI Reference Number"
    },
    status: {
        type: String,
        enum: ['requested', 'processing', 'completed', 'failed'],
        default: 'completed'
    },
    processedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        comment: "Admin who processed this payout"
    },
    notes: String,
    processedAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

technicianPayoutSchema.index({ technicianId: 1, createdAt: -1 });

module.exports = mongoose.model('TechnicianPayout', technicianPayoutSchema);
