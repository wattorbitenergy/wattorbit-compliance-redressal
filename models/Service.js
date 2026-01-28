const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema({
    serviceId: {
        type: String,
        required: true,
        unique: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        required: true
    },
    category: {
        type: String,
        required: true,
        enum: [
            'Home Appliances',
            'Electrical',
            'Plumbing',
            'Cleaning',
            'Repair & Maintenance',
            'Installation',
            'Other'
        ]
    },
    subcategory: {
        type: String,
        trim: true
    },
    images: [{
        type: String // URLs or base64 strings
    }],
    basePrice: {
        type: Number,
        required: true,
        min: 0
    },
    duration: {
        type: Number, // Duration in minutes
        required: true,
        min: 0
    },
    isActive: {
        type: Boolean,
        default: true
    },
    tags: [{
        type: String,
        trim: true
    }],
    availableCities: [{
        type: String,
        trim: true
    }],
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, { timestamps: true });

// Index for search and filtering
serviceSchema.index({ name: 'text', description: 'text', tags: 'text' });
serviceSchema.index({ category: 1, isActive: 1 });
serviceSchema.index({ availableCities: 1 });

module.exports = mongoose.model('Service', serviceSchema);
