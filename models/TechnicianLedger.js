const mongoose = require('mongoose');

const technicianLedgerSchema = new mongoose.Schema({
    technicianId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    transactionType: {
        type: String,
        enum: ['earning', 'payout', 'adjustment'],
        required: true
    },
    amount: {
        type: Number,
        required: true,
        comment: "Positive for earnings, negative for payouts"
    },
    runningBalance: {
        type: Number,
        required: true,
        comment: "Balance after this transaction"
    },
    referenceId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        comment: "ID of the TechnicianEarning or TechnicianPayout record"
    },
    description: {
        type: String,
        required: true
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        comment: "Additional data like bookingId or transactionId for quick lookup"
    }
}, { timestamps: true });

technicianLedgerSchema.index({ technicianId: 1, createdAt: -1 });
technicianLedgerSchema.index({ referenceId: 1 });

module.exports = mongoose.model('TechnicianLedger', technicianLedgerSchema);
