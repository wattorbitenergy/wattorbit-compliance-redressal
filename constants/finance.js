/**
 * Centralized Financial & Order Constants
 * Prevents enum drift across Mongoose schemas, controllers, and services.
 */

const PAYMENT_METHODS = {
    ONLINE: 'Online',
    COD: 'COD',
    UPI: 'UPI',
    WALLET: 'Wallet',
    CARD: 'Card',
    NETBANKING: 'NetBanking'
};

const PAYMENT_METHODS_LIST = Object.values(PAYMENT_METHODS);

const LEDGER_TYPES = {
    EARNING: 'EARNING',
    REFUND: 'REFUND',
    PAYOUT: 'PAYOUT',
    ADJUSTMENT: 'ADJUSTMENT',
    TRANSFER: 'TRANSFER',
    COMMISSION_DEDUCTION: 'COMMISSION_DEDUCTION',
    PAYMENT: 'PAYMENT',
    MATERIAL_PURCHASE: 'MATERIAL_PURCHASE',
    MATERIAL_PURCHASE_REFUND: 'MATERIAL_PURCHASE_REFUND'
};

const LEDGER_TYPES_LIST = Object.values(LEDGER_TYPES);

const ORDER_STATUSES = {
    CONFIRMED: 'Confirmed',
    PROCESSING: 'Processing',
    DISPATCHED: 'Dispatched',
    OUT_FOR_DELIVERY: 'Out for Delivery',
    DELIVERED: 'Delivered',
    CANCELLED: 'Cancelled'
};

const ORDER_STATUSES_LIST = Object.values(ORDER_STATUSES);

const PAYMENT_STATUSES = {
    PENDING: 'Pending',
    PAID: 'Paid',
    FAILED: 'Failed',
    REFUNDED: 'Refunded'
};

const PAYMENT_STATUSES_LIST = Object.values(PAYMENT_STATUSES);

module.exports = {
    PAYMENT_METHODS,
    PAYMENT_METHODS_LIST,
    LEDGER_TYPES,
    LEDGER_TYPES_LIST,
    ORDER_STATUSES,
    ORDER_STATUSES_LIST,
    PAYMENT_STATUSES,
    PAYMENT_STATUSES_LIST
};
