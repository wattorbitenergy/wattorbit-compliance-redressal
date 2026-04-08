const mongoose = require('mongoose');
const TechnicianEarning = require('../models/TechnicianEarning');
const FinancialLedger = require('../models/FinancialLedger');
const User = require('../models/User');

/**
 * Calculates and records technician earnings for a completed booking.
 */
async function recordTechnicianEarning(booking) {
    const session = await mongoose.startSession().catch(() => null);
    if (session) session.startTransaction();

    try {
        if (!booking.assignedTechnician) {
            if (session) await session.abortTransaction();
            return null;
        }
        if (booking.status === 'Cancelled') {
            if (session) await session.abortTransaction();
            return null;
        }

        const existing = await TechnicianEarning.findOne({ bookingId: booking._id }).session(session);
        if (existing) {
            if (session) await session.abortTransaction();
            return existing;
        }

        const techShare = Math.max(0, (booking.technicianCharges || 0) - (booking.technicianDiscountShare || 0));
        const platformPortion = (booking.platformFees || 0) + (booking.taxes || 0);
        
        const earning = await TechnicianEarning.create([{
            technicianId: booking.assignedTechnician,
            bookingId: booking._id,
            totalAmount: booking.totalAmount || 0,
            technicianShare: techShare,
            platformFee: booking.platformFees || 0,
            taxAmount: booking.taxes || 0,
            status: 'credited',
            isDemo: booking.isDemo || false,
            notes: `Earnings for booking #${booking.bookingId} (${booking.paymentMethod})`
        }], { session });

        // 💰 Deduct/Credit based on Payment Method
        // COD: Tech took cash, owes platform its portion.
        // Online: Platform took cash, owes tech their share.
        const isCOD = booking.paymentMethod === 'COD' || !booking.paymentMethod;
        const amount = isCOD ? -platformPortion : techShare;
        const type = isCOD ? 'COMMISSION_DEDUCTION' : 'EARNING';
        const description = isCOD 
            ? `Commission deducted for COD booking #${booking.bookingId}` 
            : `Earning credited for online booking #${booking.bookingId}`;

        // 📜 Record in Universal Financial Ledger
        await updateUniversalLedger(
            booking.assignedTechnician,
            type,
            amount,
            booking.bookingId || booking._id.toString(),
            description,
            { 
                bookingId: booking._id,
                paymentMethod: booking.paymentMethod || 'COD',
                breakdown: {
                    totalAmount: booking.totalAmount,
                    technicianShare: techShare,
                    platformFees: booking.platformFees,
                    taxes: booking.taxes,
                    discount: booking.discount,
                    dynamicCharges: booking.appliedDynamicCharges || []
                }
            },
            booking.isDemo || false,
            session
        );

        if (session) {
            await session.commitTransaction();
            session.endSession();
        }
        return earning[0];
    } catch (err) {
        if (session) {
            await session.abortTransaction();
            session.endSession();
        }
        console.error('Error recording technician earning:', err);
        throw err;
    }
}

/**
 * Updates the universal ledger and user balance.
 */
async function updateUniversalLedger(userId, type, amount, referenceId, description, metadata = {}, isDemo = false, session = null) {
    if (typeof amount !== 'number' || isNaN(amount)) {
        throw new Error('Invalid amount passed to ledger');
    }

    const user = await User.findById(userId).session(session);
    if (!user) throw new Error('User not found');

    // 🛡️ SECURITY FIX: Respect the sign of 'amount' passed in. 
    // Positive means inflow (credit), Negative means outflow (deduction)
    user.walletBalance = (user.walletBalance || 0) + amount;
    await user.save({ session });

    const entry = await FinancialLedger.create([{
        userId,
        type,
        amount,
        description,
        balanceAfter: user.walletBalance,
        referenceId,
        isDemo,
        metadata
    }], { session });
    
    return entry[0];
}

module.exports = {
    recordTechnicianEarning,
    updateUniversalLedger
};
