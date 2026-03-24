const Config = require('../models/Config');

/**
 * Recalculates the total amount, taxes, and fees for a booking based on its services array.
 * @param {Object} booking - The Mongoose booking document
 * @returns {Promise<Object>} - The updated booking document
 */
async function recalculateBooking(booking) {
    if (!booking.services || booking.services.length === 0) {
        return booking;
    }

    // 1. Fetch Admin Configuration for Discounts
    const discountConfig = await Config.findOne({ key: 'additional_service_discount' });
    const additionalDiscountPercent = discountConfig ? Number(discountConfig.value) : 0;

    let totalTechnicianCharges = 0;
    let totalPlatformFees = 0;
    let totalDiscount = 0;

    // 2. Process each service line item
    booking.services.forEach((item, index) => {
        // Base Charges
        const itemTechCharges = item.technicianCharges || 0;
        const itemPlatformFees = item.platformFees || 0;
        
        // Apply discount only to additional services (index > 0 or explicit flag)
        let itemDiscount = 0;
        if (item.isAdditional || index > 0) {
            itemDiscount = Math.round(((itemTechCharges + itemPlatformFees) * additionalDiscountPercent) / 100);
        }

        // Update item-level final price
        item.discount = itemDiscount;
        item.finalPrice = (itemTechCharges + itemPlatformFees) - itemDiscount;

        // Accumulate totals
        totalTechnicianCharges += itemTechCharges;
        totalPlatformFees += itemPlatformFees;
        totalDiscount += itemDiscount;
    });

    // 3. Tax Calculation (18% on platform fees ONLY)
    const taxRate = 18;
    const totalTaxes = Math.round((totalPlatformFees * taxRate) / 100);

    // 4. Final Totals
    const basePrice = totalTechnicianCharges + totalPlatformFees;
    
    // Apply Coupons or Points (if already present on booking)
    // booking.discount is usually for initial coupon/package discount
    const otherDiscounts = (booking.pointsUsed || 0) + (booking.discount || 0);

    booking.basePrice = basePrice;
    booking.technicianCharges = totalTechnicianCharges;
    booking.platformFees = totalPlatformFees;
    booking.taxes = totalTaxes;
    booking.lineItemDiscount = totalDiscount; 
    booking.totalAmount = Math.max(0, basePrice + totalTaxes - totalDiscount - otherDiscounts);

    return booking;
}

module.exports = {
    recalculateBooking
};
