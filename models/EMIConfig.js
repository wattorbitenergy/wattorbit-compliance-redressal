const mongoose = require('mongoose');

const bankRateSchema = new mongoose.Schema({
    bankCode: {
        type: String,
        required: true,
        uppercase: true,
        trim: true
    },
    bankName: {
        type: String,
        required: true,
        trim: true
    },
    logoUrl: {
        type: String,
        default: ''
    },
    type: {
        type: String,
        enum: ['credit', 'debit', 'cardless'],
        default: 'credit'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    // Gateway processing surcharge / buffer markup % added to interest rate to cover gateway fees
    gatewayBufferRate: {
        type: Number,
        default: 1.5, // e.g. 1.5%
        min: 0,
        max: 10
    },
    // Rates per tenure in annual percentage rate (APR %)
    tenures: [{
        months: {
            type: Number,
            required: true,
            enum: [3, 6, 9, 12, 18, 24]
        },
        annualRate: {
            type: Number,
            required: true,
            min: 0,
            max: 36 // e.g., 14.5% p.a.
        },
        minAmount: {
            type: Number,
            default: 3000
        },
        isNoCostAvailable: {
            type: Boolean,
            default: false
        }
    }]
}, { _id: false });

const emiConfigSchema = new mongoose.Schema({
    key: {
        type: String,
        default: 'emi_global_settings',
        unique: true
    },
    isEnabled: {
        type: Boolean,
        default: true
    },
    globalMinAmount: {
        type: Number,
        default: 3000
    },
    globalGatewayFeePercent: {
        type: Number,
        default: 2.0 // Standard gateway charge e.g. 2.0%
    },
    banks: [bankRateSchema]
}, { timestamps: true });

module.exports = mongoose.model('EMIConfig', emiConfigSchema);
