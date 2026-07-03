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
    addressId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Address',
        required: true
    },
    paymentMethod: {
        type: String,
        default: 'Online',
        enum: ['Online', 'COD'] // Standalone orders can be prepaid or Cash on Delivery
    },
    codCharge: {
        type: Number,
        default: 0
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
        enum: ['Confirmed', 'Processing', 'Dispatched', 'Delivered', 'Cancelled'],
        default: 'Confirmed'
    },
    deliveryPartner: String,
    trackingId: String,
    notes: String
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
