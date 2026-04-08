const mongoose = require('mongoose');

const financialLedgerSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        comment: "The user (Technician, Customer, or Engineer) this entry belongs to"
    },
    type: {
        type: String,
        enum: ['EARNING', 'REFUND', 'PAYOUT', 'ADJUSTMENT', 'TRANSFER', 'COMMISSION_DEDUCTION', 'PAYMENT'],
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    balanceAfter: {
        type: Number,
        required: true,
        comment: "Running balance (wallet or escrow) after this transaction"
    },
    referenceId: {
        type: String,
        required: false,
        comment: "Booking ID, Payout ID, or Transaction ID"
    },
    isDemo: {
        type: Boolean,
        default: false
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed
    }
}, { timestamps: true });

financialLedgerSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('FinancialLedger', financialLedgerSchema);
