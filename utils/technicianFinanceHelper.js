const TechnicianEarning = require('../models/TechnicianEarning');
const FinancialLedger = require('../models/FinancialLedger');
const User = require('../models/User');

/**
 * Calculates and records technician earnings for a completed booking.
 */
async function recordTechnicianEarning(booking) {
    try {
        if (!booking.assignedTechnician) return null;
        if (booking.status === 'Cancelled') return null;

        const existing = await TechnicianEarning.findOne({ bookingId: booking._id });
        if (existing) return existing;

        const technicianCharges = booking.technicianCharges || 0;
        const technicianDiscountShare = booking.technicianDiscountShare || 0;
        const technicianShare = Math.max(0, technicianCharges - technicianDiscountShare);

        const earning = await TechnicianEarning.create({
            technicianId: booking.assignedTechnician,
            bookingId: booking._id,
            totalAmount: booking.totalAmount || 0,
            technicianShare,
            platformFee: booking.platformFees || 0,
            taxAmount: booking.taxes || 0,
            status: 'credited',
            isDemo: booking.isDemo || false,
            notes: `Earnings for booking #${booking.bookingId}`
        });

        // 📜 Record in Universal Financial Ledger
        await updateUniversalLedger(
            booking.assignedTechnician,
            'EARNING',
            technicianShare,
            booking.bookingId || booking._id.toString(),
            `Earning credited for booking #${booking.bookingId}`,
            { bookingId: booking._id },
            booking.isDemo || false
        );

        return earning;
    } catch (err) {
        console.error('Error recording technician earning:', err);
        throw err;
    }
}

/**
 * Updates the universal ledger and user balance.
 */
async function updateUniversalLedger(userId, type, amount, referenceId, description, metadata = {}, isDemo = false) {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    // Technician balance is stored in 'walletBalance' or we can add 'balance'
    // Let's use 'walletBalance' as the primary source of truth for all users' internal credits
    const change = type === 'PAYOUT' ? -Math.abs(amount) : Math.abs(amount);
    user.walletBalance = (user.walletBalance || 0) + change;
    await user.save();

    const entry = await FinancialLedger.create({
        userId,
        type,
        amount: change,
        description,
        balanceAfter: user.walletBalance,
        referenceId,
        isDemo,
        metadata
    });
    
    return entry;
}

module.exports = {
    recordTechnicianEarning,
    updateUniversalLedger
};
