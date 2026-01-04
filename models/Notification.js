const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    title: { type: String, required: true },
    message: { type: String, required: true },
    targetRole: {
        type: String,
        enum: ['all', 'user', 'technician', 'engineer', 'organisation'],
        default: 'all'
    },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Notification', notificationSchema);
