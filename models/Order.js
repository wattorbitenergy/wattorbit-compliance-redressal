const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    orderId: {
        type: String,
        unique: true,
        sparse: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    items: [{
        materialId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Material',
            required: true
        },
        name: String,
        make: String,
        quantity: {
            type: Number,
            required: true,
            min: 1
        },
        sellingPrice: Number,      // Snapshot at time of order
        sellingTaxRate: Number,    // Snapshot
        sellingTaxAmount: Number,  // Snapshot
        totalLineAmount: Number    // Qty * (Price + Tax)
    }],
    totalAmount: {
        type: Number,
        required: true
    },
    deliveryFee: {
        type: Number,
        default: 0
    },
    chargeableWeight: {
        type: Number,
        default: 0
    },
    baseDeliveryFee: {
        type: Number,
        default: 0
    },
    volumetricWeightFee: {
        type: Number,
        default: 0
    },
    addressId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Address',
        required: true
    },
    paymentMethod: {
        type: String,
        default: 'Online',
        enum: ['Online'] // Standalone orders are prepaid only
    },
    paymentStatus: {
        type: String,
        enum: ['Pending', 'Paid', 'Failed', 'Refunded'],
        default: 'Pending'
    },
    razorpayOrderId: String,
    razorpayPaymentId: String,
    status: {
        type: String,
        enum: ['Pending', 'Confirmed', 'Packed', 'Dispatched', 'In Transit', 'Arrived at Hub', 'Out for Delivery', 'Delivered', 'Cancelled'],
        default: 'Pending'
    },
    deliveryMode: {
        type: String,
        enum: ['Unassigned', 'Internal', 'External'],
        default: 'Unassigned'
    },
    deliveryBoyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    logisticsPartner: String,
    externalTrackingId: String,
    deliveryPartner: String,
    trackingId: String,
    notes: String,
    trackingHistory: [{
        status: String,
        location: String,
        message: String,
        timestamp: { type: Date, default: Date.now }
    }]
}, { timestamps: true });

// Auto-generate Order ID
orderSchema.pre('save', async function () {
    if (this.isNew && !this.orderId) {
        const count = await this.constructor.countDocuments();
        this.orderId = (6000001 + count).toString();
    }
});

module.exports = mongoose.model('Order', orderSchema);
