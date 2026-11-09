const mongoose = require('mongoose');
const { PAYMENT_METHODS_LIST, ORDER_STATUSES_LIST, PAYMENT_STATUSES_LIST } = require('../constants/finance');

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
    addressId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Address',
        required: true
    },
    paymentMethod: {
        type: String,
        default: 'Online',
        enum: PAYMENT_METHODS_LIST
    },
    codCharge: {
        type: Number,
        default: 0
    },
    deliveryFee: {
        type: Number,
        default: 0
    },
    paymentStatus: {
        type: String,
        enum: PAYMENT_STATUSES_LIST,
        default: 'Pending'
    },
    razorpayOrderId: String,
    razorpayPaymentId: String,
    status: {
        type: String,
        enum: ORDER_STATUSES_LIST,
        default: 'Confirmed'
    },
    deliveryPartner: String,
    trackingId: String,
    notes: String,
    couponDiscount: {
        type: Number,
        default: 0
    },
    deliveryDiscountReason: {
        type: String,
        default: ''
    },
    invoiceUrl: { 
        type: String 
    },
    deliveryType: {
        type: String,
        enum: ['internal', 'delhivery', 'porter', 'manual', 'custom', 'external'],
        default: 'manual'
    },
    deliveryPartnerContact: String,
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    awbNumber: String,
    shipmentId: String,
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
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const count = await this.constructor.countDocuments() + 1001;
        this.orderId = `ORD-${year}${month}-${count}`;
    }
});

module.exports = mongoose.model('Order', orderSchema);
