const Counter = require('../models/Counter');

/**
 * Get next sequence number for a given counter type
 * @param {String} counterType - Type of counter (e.g., 'service', 'booking', 'payment')
 * @param {String} prefix - Prefix for the ID (e.g., 'SVC', 'BKG', 'PAY')
 * @returns {Promise<String>} - Generated ID (e.g., 'SVC-001')
 */
async function getNextSequence(counterType, prefix = '') {
    const year = new Date().getFullYear();
    const counterId = `${counterType}-${year}`;

    const counter = await Counter.findByIdAndUpdate(
        counterId,
        { $inc: { seq: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const paddedSeq = String(counter.seq).padStart(3, '0');
    return prefix ? `${prefix}-${paddedSeq}` : paddedSeq;
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
 */
async function generateBookingId() {
    return await getNextSequence('booking', 'BKG');
}

/**
 * Generate payment ID
 */
async function generatePaymentId() {
    return await getNextSequence('payment', 'PAY');
}

/**
 * Generate invoice ID
 */
async function generateInvoiceId() {
    const year = new Date().getFullYear();
    const seq = await getNextSequence('invoice', '');
    return `INV-${year}-${seq}`;
}

module.exports = {
    getNextSequence,
    generateServiceId,
    generatePackageId,
    generateBookingId,
    generatePaymentId,
    generateInvoiceId
};
