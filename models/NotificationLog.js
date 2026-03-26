const mongoose = require('mongoose');

const notificationLogSchema = new mongoose.Schema({
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true,
        index: true 
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    data: { type: Object, default: {} },
    imageUrl: { type: String },
    isRead: { type: Boolean, default: false },
    createdAt: { 
        type: Date, 
        default: Date.now, 
        index: true,
        expires: '10d' // Automatically delete logs older than 10 days
    }
}, { timestamps: true });

module.exports = mongoose.model('NotificationLog', notificationLogSchema);
