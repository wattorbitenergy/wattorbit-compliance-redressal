const mongoose = require('mongoose');

const adminLogSchema = new mongoose.Schema({
    adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    action: {
        type: String,
        required: true,
        comment: "e.g., UPDATE_SERVICE, DELETE_USER, LOGIN_SUCCESS"
    },
    method: {
        type: String,
        required: true
    },
    endpoint: {
        type: String,
        required: true
    },
    details: {
        type: mongoose.Schema.Types.Mixed,
        comment: "Request body or params"
    },
    ipAddress: {
        type: String
    },
    userAgent: {
        type: String
    }
}, { timestamps: true });

adminLogSchema.index({ adminId: 1, createdAt: -1 });
adminLogSchema.index({ action: 1 });

module.exports = mongoose.model('AdminLog', adminLogSchema);
