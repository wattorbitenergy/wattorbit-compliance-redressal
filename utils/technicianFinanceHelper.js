const TechnicianEarning = require('../models/TechnicianEarning');
const TechnicianLedger = require('../models/TechnicianLedger');
const User = require('../models/User');

/**
 * Calculates and records technician earnings for a completed booking.
 * Should be called when a booking is marked as 'Completed' and 'paid'.
 */
async function recordTechnicianEarning(booking) {
    try {
        if (!booking.assignedTechnician) {
            console.warn(`Booking ${booking.bookingId} has no assigned technician. Skipping earnings calculation.`);
            return null;
        }

        // 1. Check if earning already exists to prevent duplicates
        const existing = await TechnicianEarning.findOne({ bookingId: booking._id });
        if (existing) return existing;

        // 2. Financial Breakdown (Based on Booking Pricing)
        const totalAmount = booking.totalAmount || 0;
        const technicianShare = booking.technicianCharges || 0;
        const platformFee = booking.platformFees || 0;
        const taxAmount = booking.taxes || 0;

        // 3. Create Earning Record
        const earning = await TechnicianEarning.create({
            technicianId: booking.assignedTechnician,
            bookingId: booking._id,
            totalAmount,
            technicianShare,
            platformFee,
            taxAmount,
            status: 'credited',
            notes: `Earnings for booking #${booking.bookingId}`
        });

        // 4. Update Ledger
        await updateTechnicianLedger(
            booking.assignedTechnician,
            'earning',
            technicianShare,
            earning._id,
            `Earning credited for booking #${booking.bookingId}`,
            { bookingId: booking._id }
        );

        return earning;
    } catch (err) {
        console.error('Error recording technician earning:', err);
        throw err;
    }
}

/**
 * Updates the technician's ledger and running balance.
 */
async function updateTechnicianLedger(technicianId, type, amount, referenceId, description, metadata = {}) {
    // Get latest ledger entry for running balance
    const lastEntry = await TechnicianLedger.findOne({ technicianId }).sort({ createdAt: -1 });
    const currentBalance = lastEntry ? lastEntry.runningBalance : 0;
    
    // For payouts, amount should be passed as positive, but we subtract it
    const change = type === 'payout' ? -Math.abs(amount) : Math.abs(amount);
    const newBalance = currentBalance + change;

    const entry = await TechnicianLedger.create({
        technicianId,
        transactionType: type,
        amount: change,
        runningBalance: newBalance,
        referenceId,
        description,
        metadata
    });

    // We could also update a 'technicianBalance' field on the User model for quick read access
    // if performance becomes an issue. For now, we rely on the ledger.
    
    return entry;
}

module.exports = {
    recordTechnicianEarning,
    updateTechnicianLedger
};
