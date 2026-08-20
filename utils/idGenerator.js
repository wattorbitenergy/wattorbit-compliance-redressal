const Counter = require('../models/Counter');

/**
 * Get next sequence number for a given counter type
 * @param {String} counterType - Type of counter (e.g., 'service', 'booking', 'payment')
 * @param {String} prefix - Prefix for the ID (e.g., 'SVC', 'BKG', 'PAY')
 * @returns {Promise<String>} - Generated ID (e.g., 'SVC-001')
 */
async function getNextSequence(counterType, prefix = '', padding = 3, separator = '-') {
    const year = new Date().getFullYear();
    const counterId = `${counterType}-${year}`;

    const counter = await Counter.findByIdAndUpdate(
        counterId,
        { $inc: { seq: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const paddedSeq = String(counter.seq).padStart(padding, '0');
    return prefix ? `${prefix}${separator}${paddedSeq}` : paddedSeq;
}

/**
 * Generate service ID
 */
async function generateServiceId() {
    return await getNextSequence('service', 'SVC');
}

/**
 * Generate package ID
 */
async function generatePackageId() {
    return await getNextSequence('package', 'PKG');
}

/**
 * Generate booking ID
 * Format: BKG-YYYY-NNNN (e.g., BKG-2026-0001)
 */
async function generateBookingId() {
    const year = new Date().getFullYear();
    const prefix = `BKG-${year}`;
    return await getNextSequence('booking', prefix, 4, '-');
}

/**
 * Generate payment ID
 */
async function generatePaymentId() {
    return await getNextSequence('payment', 'PAY');
}

/**
 * Generate invoice ID (increments counter - use only when actually saving)
 */
async function generateInvoiceId() {
    const year = new Date().getFullYear();
    const seq = await getNextSequence('invoice', '');
    return `INV-${year}-${seq}`;
}

/**
 * Peek at next invoice ID without incrementing the counter.
 * Used for previewing the next invoice number on the frontend.
 */
async function peekNextInvoiceId() {
    const year = new Date().getFullYear();
    const counterId = `invoice-${year}`;
    const counter = await Counter.findById(counterId);
    const nextSeq = (counter ? counter.seq : 0) + 1;
    const padded = String(nextSeq).padStart(3, '0');
    return `INV-${year}-${padded}`;
}

/**
 * Generate Work Permit ID
 * Format: WP-YYYY-NNN (e.g., WP-2026-001)
 */
async function generateWorkPermitId() {
    const year = new Date().getFullYear();
    const prefix = `WP-${year}`;
    return await getNextSequence('work-permit', prefix, 3, '-');
}

module.exports = {
    getNextSequence,
    generateServiceId,
    generatePackageId,
    generateBookingId,
    generatePaymentId,
    generateInvoiceId,
    peekNextInvoiceId,
    generateWorkPermitId
};
