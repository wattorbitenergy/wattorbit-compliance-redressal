const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({
    invoiceId: {
        type: String,
        required: true,
        unique: true
    },
    bookingId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking',
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    // Invoice details
    invoiceDate: {
        type: Date,
        default: Date.now
    },
    dueDate: {
        type: Date
    },

    // Line items
    items: [{
        description: {
            type: String,
            required: true
        },
        quantity: {
            type: Number,
            default: 1,
            min: 1
        },
        unitPrice: {
            type: Number,
            required: true,
            min: 0
        },
        total: {
            type: Number,
            required: true,
            min: 0
        }
    }],

    // Pricing breakdown
    subtotal: {
        type: Number,
        required: true,
        min: 0
    },
    taxRate: {
        type: Number,
        default: 18, // 18% GST
        min: 0,
        max: 100
    },
    taxAmount: {
        type: Number,
        required: true,
        min: 0
    },
    discount: {
        type: Number,
        default: 0,
        min: 0
    },
    totalAmount: {
        type: Number,
        required: true,
        min: 0
    },

    // Payment status
    paymentStatus: {
        type: String,
        enum: ['Unpaid', 'Paid', 'Partial', 'Refunded'],
        default: 'Unpaid'
    },
    paidAmount: {
        type: Number,
        default: 0,
        min: 0
    },

    // Business details
    businessName: {
        type: String,
        default: 'WattOrbit Energy Solutions'
    },
    businessGST: {
        type: String,
        default: ''
    },
    businessAddress: {
        type: String,
        default: ''
    },

    // Customer details (snapshot at time of invoice)
    customerName: {
        type: String,
        required: true
    },
    customerPhone: {
        type: String,
        required: true
    },
    customerEmail: {
        type: String
    },
    customerAddress: {
        type: String,
        required: true
    }
}, { timestamps: true });

// Indexes for efficient queries
invoiceSchema.index({ bookingId: 1 });
invoiceSchema.index({ userId: 1, createdAt: -1 });
invoiceSchema.index({ paymentStatus: 1 });
invoiceSchema.index({ invoiceDate: -1 });

module.exports = mongoose.model('Invoice', invoiceSchema);
