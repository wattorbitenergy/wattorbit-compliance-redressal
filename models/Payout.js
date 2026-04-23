const mongoose = require('mongoose');

const payoutSchema = new mongoose.Schema({
    payoutId: {
        type: String,
        unique: true,
        required: true
    },
    technicianId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    upiId: {
        type: String,
        required: true
    },
    transactionRef: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        enum: ['Pending', 'Completed', 'Failed'],
        default: 'Completed' // Since admin records it manually after paying
    },
    notes: String,
    initiatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, { timestamps: true });

module.exports = mongoose.model('Payout', payoutSchema);
