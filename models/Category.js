const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        unique: true
    },
    icon: {
        type: String, // Can be a Lucide icon name or image URL
        required: true
    },
    description: {
        type: String,
        trim: true
    },
    order: {
        type: Number,
        default: 0
    },
    isActive: {
        type: Boolean,
        default: true
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, { timestamps: true });

// Index for ordering
categorySchema.index({ order: 1, name: 1 });

module.exports = mongoose.model('Category', categorySchema);
