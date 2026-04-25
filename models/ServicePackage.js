const mongoose = require('mongoose');

const servicePackageSchema = new mongoose.Schema({
    packageId: {
        type: String,
        required: true,
        unique: true
    },
    serviceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Service',
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    sacCode: {
        type: String,
        default: '998700',
        trim: true
    },
    description: {
        type: String,
        required: true
    },
    price: {
        type: Number,
        required: true,
        min: 0
    },
    technicianCharges: {
        type: Number,
        required: true,
        default: 0,
        min: 0
    },
    platformFees: {
        type: Number,
        required: true,
        default: 0,
        min: 0
    },
    taxRate: {
        type: Number,
        default: 18,
        enum: [0, 5, 12, 18, 28]
    },
    duration: {
        type: Number, // Duration in minutes
        required: true,
        min: 0
    },
    features: [{
        type: String,
        trim: true
    }],
    isPopular: {
        type: Boolean,
        default: false
    },
    isActive: {
        type: Boolean,
        default: true
    },
    discount: {
        percentage: {
            type: Number,
            min: 0,
            max: 100,
            default: 0
        },
        validUntil: {
            type: Date
        }
    },
    dynamicCharges: [{
        name: { type: String, required: true },
        amount: { type: Number, required: true, min: 0 },
        recipient: { type: String, enum: ['Platform', 'Technician'], default: 'Platform' },
        isActive: { type: Boolean, default: true }
    }]
}, { timestamps: true });

// Index for efficient queries
servicePackageSchema.index({ serviceId: 1, isActive: 1 });
servicePackageSchema.index({ isPopular: 1 });

module.exports = mongoose.model('ServicePackage', servicePackageSchema);
