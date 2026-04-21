/**
 * Financial Rounding Utility
 * Ensures all currency/tax calculations are rounded to 2 decimal places
 * to prevent floating-point errors (e.g. 72.2200000004)
 * @param {number|string} num - The number to round
 * @returns {number} - Rounded number with max 2 decimals
 */
const round = (num) => {
    const val = typeof num === 'string' ? parseFloat(num) : num;
    if (isNaN(val)) return 0;
    return parseFloat(val.toFixed(2));
};

module.exports = { round };
