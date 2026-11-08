const mongoose = require('mongoose');

const sellerSettlementSchema = new mongoose.Schema({
    settlementId: {
        type: String,
        unique: true,
        required: true,
        comment: 'Auto-generated e.g. STL-2026-0001'
    },
    sellerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        required: true
    },
    orderCode: {
        type: String,
        required: true,
        comment: 'Human-readable order ID e.g. ORD-10023'
    },
    // Financial Breakdown
    grossSaleAmount: {
        type: Number,
        required: true,
        comment: 'Gross total paid by buyer for this seller items (incl. GST)'
    },
    taxableSaleAmount: {
        type: Number,
        required: true,
        comment: 'Net product price (excluding tax)'
    },
    productGSTAmount: {
        type: Number,
        required: true,
        comment: 'Output GST on goods (belongs to seller)'
    },
    // Deductions
    commissionRate: {
        type: Number,
        default: 10,
        comment: 'Marketplace commission percentage'
    },
    commissionAmount: {
        type: Number,
        required: true,
        comment: 'Base commission charged by WattOrbit'
    },
    commissionGSTAmount: {
        type: Number,
        required: true,
        comment: '18% GST on platform commission'
    },
    tcsRate: {
        type: Number,
        default: 1,
        comment: '1% statutory TCS under Sec 52'
    },
    tcsAmount: {
        type: Number,
        required: true,
        comment: '1% TCS deducted for GSTR-8'
    },
    gatewayFeeAmount: {
        type: Number,
        default: 0,
        comment: 'Payment gateway handling fee'
    },
    // Net Result
    netPayoutAmount: {
        type: Number,
        required: true,
        comment: 'Gross Sale - (Commission + Comm GST + TCS + Gateway)'
    },
    // Settlement Status Lifecycle
    status: {
        type: String,
        enum: ['escrow_hold', 'ready_for_payout', 'payout_processing', 'settled', 'refund_hold'],
        default: 'escrow_hold'
    },
    settlementDueDate: {
        type: Date,
        comment: 'T+7 or T+14 return window clearance date'
    },
    payoutReference: {
        type: String,
        default: '',
        comment: 'Bank UTR or payout transaction reference'
    },
    settledAt: {
        type: Date
    }
}, { timestamps: true });

sellerSettlementSchema.index({ sellerId: 1, createdAt: -1 });
sellerSettlementSchema.index({ status: 1 });
sellerSettlementSchema.index({ orderId: 1 });

module.exports = mongoose.model('SellerSettlement', sellerSettlementSchema);
