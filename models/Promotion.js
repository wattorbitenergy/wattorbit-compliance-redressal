const mongoose = require('mongoose');

const promotionSchema = new mongoose.Schema({
    title: {
        type: String,
        trim: true
    },
    content: {
        type: String,
        trim: true
    },
    location: {
        type: String,
        default: 'all',
        trim: true
    },
    layout: {
        type: String,
        enum: ['standard', 'horizontal', 'parallel'],
        default: 'standard'
    },
    mediaUrl: {
        type: String,
        trim: true
    },
    mediaType: {
        type: String,
        enum: ['image', 'video'],
        default: 'image'
    },
    position: {
        type: String,
        enum: ['top', 'bottom'],
        default: 'top',
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    link: {
        type: String,
        trim: true
    },
    backgroundColor: {
        type: String,
        default: '#3b82f6' // Default blue
    },
    textColor: {
        type: String,
        default: '#ffffff' // Default white
    },
    page: {
        type: String,
        enum: ['home', 'track', 'all'],
        default: 'all'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Promotion', promotionSchema);
