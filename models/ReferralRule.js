const mongoose = require('mongoose');

const referralRuleSchema = new mongoose.Schema({
    targetRole: {
        type: String,
        enum: ['user', 'technician', 'engineer', 'organisation'],
        required: true
    },
    targetSpecialization: {
        type: String,
        default: '' // '' for any or user, 'Electrician' etc for technician
    },
    referrerReward: {
        type: Number,
        default: 100
    },
    refereeReward: {
        type: Number,
        default: 50
    },
    description: String,
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('ReferralRule', referralRuleSchema);
