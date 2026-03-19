const mongoose = require('mongoose');

const curationSchema = new mongoose.Schema({
    title: {
        type: String,
        trim: true,
        required: true
    },
    subtitle: {
        type: String,
        trim: true
    },
    mediaUrl: {
        type: String,
        trim: true
    },
    mediaType: {
        type: String,
        enum: ['image', 'gif', 'video'],
        default: 'image'
    },
    targetServiceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Service'
    },
    targetPackageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ServicePackage'
    },
    link: {
        type: String,
        trim: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    order: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

module.exports = mongoose.model('Curation', curationSchema);
