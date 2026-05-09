const mongoose = require('mongoose');

const logisticsConfigSchema = new mongoose.Schema({
    providerName: {
        type: String,
        required: true,
        unique: true
    },
    apiKey: {
        type: String,
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('LogisticsConfig', logisticsConfigSchema);
