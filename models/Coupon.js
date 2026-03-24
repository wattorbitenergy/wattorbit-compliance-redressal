const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
    code: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true
    },
    discountType: {
        type: String,
        enum: ['percentage', 'flat'],
        required: true
    },
    technicianAbsorbsPercent: {
        type: Number,
        min: 0,
        max: 100,
        default: null // null means proportional split
    },
    discountValue: {
        type: Number,
        required: true,
        min: 0
    },
    minOrderAmount: {
        type: Number,
        default: 0
    },
    maxDiscount: {
        type: Number,
        default: 0 // 0 means no limit for percentage discounts
    },
    expiryDate: {
        type: Date,
        required: true
    },
    usageLimit: {
        type: Number,
        default: null // null means unlimited
    },
    usedCount: {
        type: Number,
        default: 0
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

// Check if coupon is valid
couponSchema.methods.isValid = function (orderAmount) {
    const now = new Date();
    if (!this.isActive) return false;
    if (this.expiryDate < now) return false;
    if (this.usageLimit !== null && this.usedCount >= this.usageLimit) return false;
    if (orderAmount < this.minOrderAmount) return false;
    return true;
};

// Calculate discount amount
couponSchema.methods.calculateDiscount = function (orderAmount) {
    let discount = 0;
    if (this.discountType === 'percentage') {
        discount = (orderAmount * this.discountValue) / 100;
        if (this.maxDiscount > 0 && discount > this.maxDiscount) {
            discount = this.maxDiscount;
        }
    } else {
        discount = this.discountValue;
    }
    return Math.min(discount, orderAmount);
};

module.exports = mongoose.model('Coupon', couponSchema);
