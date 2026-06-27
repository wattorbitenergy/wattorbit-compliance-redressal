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
        description: { type: String, required: true },
        hsnSac: { type: String, trim: true },
        quantity: { type: Number, default: 1 },
        unitPrice: { type: Number, required: true },
        taxableValue: { type: Number, required: true },
        taxRate: { type: Number, default: 0 },
        taxAmount: { type: Number, default: 0 },
        // Component breakdown for audit
        cgstRate: { type: Number, default: 0 },
        cgstAmount: { type: Number, default: 0 },
        sgstRate: { type: Number, default: 0 },
        sgstAmount: { type: Number, default: 0 },
        igstRate: { type: Number, default: 0 },
        igstAmount: { type: Number, default: 0 },
        total: { type: Number, required: true }
    }],

    // Pricing breakdown
    subtotal: { type: Number, required: true }, // Total taxable value
    taxAmount: { type: Number, required: true }, // Total GST
    discount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    amountInWords: { type: String },

    // Global Tax breakdown
    totalCGST: { type: Number, default: 0 },
    totalSGST: { type: Number, default: 0 },
    totalIGST: { type: Number, default: 0 },

    // Supply Details
    placeOfSupply: { type: String }, // State Name
    stateCode: { type: String }, // e.g., 09

    // Payment status
    paymentStatus: {
        type: String,
        enum: ['Unpaid', 'Paid', 'Partial', 'Refunded', 'Cancelled'],
        default: 'Unpaid'
    },
    paidAmount: { type: Number, default: 0 },

    // Business details (Snapshot for audit)
    businessName: { type: String, default: 'WATTORBIT ENERGY SOLUTIONS LLP' },
    businessGST: { type: String, default: '09AAFFW4253N1ZL' },
    businessPAN: { type: String, default: 'AAFFW4253N' },
    businessAddress: { type: String },
    
    // Bank Details (Snapshot for audit)
    bankDetails: {
        accountHolderName: String,
        accountNumber: String,
        ifscCode: String,
        bankName: String,
        branchName: String
    },

    // Customer details (snapshot at time of invoice)
    customerName: { type: String, required: true },
    customerPhone: { type: String, required: true },
    customerEmail: { type: String },
    customerAddress: { type: String, required: true },
    customerGST: { type: String }, // For B2B
}, { timestamps: true });

// Indexes for efficient queries
invoiceSchema.index({ bookingId: 1 });
invoiceSchema.index({ userId: 1, createdAt: -1 });
invoiceSchema.index({ paymentStatus: 1 });
invoiceSchema.index({ invoiceDate: -1 });

module.exports = mongoose.model('Invoice', invoiceSchema);
