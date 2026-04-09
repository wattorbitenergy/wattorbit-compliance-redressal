const mongoose = require('mongoose');
const TechnicianEarning = require('../models/TechnicianEarning');
const FinancialLedger = require('../models/FinancialLedger');
const User = require('../models/User');

/**
 * Calculates and records technician earnings for a completed booking.
 */
async function recordTechnicianEarning(booking) {
    let session = null;
    try {
        // 💎 ATOMIC SECURITY: Transactions ensure balance and logs never desync.
        // Fallback for standalone Mongo instances (errors if session not supported)
        session = await mongoose.startSession();
        session.startTransaction();
    } catch (e) {
        session = null; // System continues in non-transactional mode if DB doesn't support it
        console.warn('⚠️ MongoDB Transaction not supported in this environment. Falling back to standard mode.');
    }

    try {
        if (!booking.assignedTechnician) {
            if (session) {
                await session.abortTransaction();
                session.endSession();
            }
            return null;
        }
        if (booking.status === 'Cancelled') {
            if (session) {
                await session.abortTransaction();
                session.endSession();
            }
            return null;
        }

        const existingFilter = { bookingId: booking._id };
        const existing = await TechnicianEarning.findOne(existingFilter).session(session);
        if (existing) {
            if (session) {
                await session.abortTransaction();
                session.endSession();
            }
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
    // 🧪 DEMO CHECK: Demo bookings do NOT create financial liability.
    if (!isDemo) {
        const newBalance = (user.walletBalance || 0) + amount;

        // 💰 ROLE GUARD: Only technicians can have negative wallet balance
        // (they owe commission to the platform for COD jobs).
        // All other roles (user, organisation, employee) are always >= 0.
        const isTechnician = user.role === 'technician';
        user.walletBalance = isTechnician ? newBalance : Math.max(0, newBalance);

        await user.save({ session });
    }

    const entry = await FinancialLedger.create([{
        userId,
        type,
        amount,
        description: isDemo ? `[DEMO - NO BALANCE IMPACT] ${description}` : description,
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
