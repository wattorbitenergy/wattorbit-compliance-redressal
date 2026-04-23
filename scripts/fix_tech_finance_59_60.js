const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const TechnicianEarning = require('../models/TechnicianEarning');
const FinancialLedger = require('../models/FinancialLedger');
const User = require('../models/User');
require('dotenv').config();

/**
 * Correction script for BKG-2026-0059 and BKG-2026-0060
 * 
 * Problem: These were paid online to company QR (Platform collected) but system 
 * treated them as COD (Technician collected) because paymentCollectedBy was not set.
 * 
 * Fix:
 * 1. Reverse wrong COMMISSION_DEDUCTION entries
 * 2. Apply correct EARNING entries  
 * 3. Update booking records (paymentCollectedBy, paymentMethod)
 * 4. Recalculate technician wallet
 */

async function fix() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to database\n');

        const bookingIds = ['BKG-2026-0059', 'BKG-2026-0060'];
        const bookings = await Booking.find({ bookingId: { $in: bookingIds } });

        if (bookings.length !== 2) {
            console.error(`Expected 2 bookings, found ${bookings.length}`);
            return;
        }

        const techId = bookings[0].assignedTechnician;
        const tech = await User.findById(techId);
        console.log(`Technician: ${tech.name}`);
        console.log(`Current wallet balance: ₹${tech.walletBalance}\n`);

        for (const booking of bookings) {
            console.log(`--- Fixing ${booking.bookingId} ---`);

            const techShare = Math.max(0, (booking.technicianCharges || 0) - (booking.technicianDiscountShare || 0));
            const netPlatformFees = Math.max(0, (booking.platformFees || 0) - (booking.platformDiscountShare || 0));
            const platformPortion = netPlatformFees + (booking.taxes || 0);

            console.log(`  Tech Share: ₹${techShare}`);
            console.log(`  Platform Portion: ₹${platformPortion}`);

            // Step 1: Delete wrong TechnicianEarning record
            const deletedEarning = await TechnicianEarning.findOneAndDelete({ bookingId: booking._id });
            if (deletedEarning) {
                console.log(`  ✅ Deleted wrong earning record`);
            } else {
                console.log(`  ⚠️  No earning record found to delete`);
            }

            // Step 2: Delete wrong ledger entry (COMMISSION_DEDUCTION)
            const deletedLedger = await FinancialLedger.findOneAndDelete({
                userId: techId,
                referenceId: booking.bookingId,
                type: 'COMMISSION_DEDUCTION'
            });
            if (deletedLedger) {
                // Reverse the wallet impact: add back the deducted amount
                tech.walletBalance = (tech.walletBalance || 0) - deletedLedger.amount; // amount was negative, so subtracting negative = adding
                console.log(`  ✅ Reversed COMMISSION_DEDUCTION of ₹${deletedLedger.amount} → wallet now ₹${tech.walletBalance}`);
            } else {
                console.log(`  ⚠️  No COMMISSION_DEDUCTION ledger entry found`);
            }

            // Step 3: Create correct TechnicianEarning record
            const newEarning = await TechnicianEarning.create({
                technicianId: techId,
                bookingId: booking._id,
                totalAmount: booking.totalAmount || 0,
                technicianShare: techShare,
                platformFee: netPlatformFees,
                taxAmount: booking.taxes || 0,
                status: 'credited',
                isDemo: false,
                notes: `[CORRECTED] Earnings for booking #${booking.bookingId} (Online - Platform collected)`
            });
            console.log(`  ✅ Created correct earning record (share: ₹${techShare})`);

            // Step 4: Create correct ledger entry (EARNING - Platform collected, tech gets credited)
            tech.walletBalance = (tech.walletBalance || 0) + techShare;
            const newLedger = await FinancialLedger.create({
                userId: techId,
                type: 'EARNING',
                amount: techShare,
                description: `[CORRECTED] Earning credited for booking #${booking.bookingId} (Collected by Platform - Online QR)`,
                balanceAfter: tech.walletBalance,
                referenceId: booking.bookingId,
                isDemo: false,
                metadata: {
                    bookingId: booking._id,
                    paymentMethod: 'Online',
                    correctionReason: 'Payment was collected online on company QR but was wrongly recorded as COD/Technician-collected',
                    breakdown: {
                        totalAmount: booking.totalAmount,
                        technicianShare: techShare,
                        platformFees: netPlatformFees,
                        taxes: booking.taxes,
                        discount: booking.discount
                    }
                }
            });
            console.log(`  ✅ Created EARNING ledger entry (+₹${techShare}) → wallet now ₹${tech.walletBalance}`);

            // Step 5: Update booking record
            booking.paymentCollectedBy = 'Platform';
            booking.paymentMethod = 'Online';
            booking.statusHistory.push({
                status: booking.status,
                timestamp: new Date(),
                notes: `[ADMIN CORRECTION] Payment method corrected: COD → Online (Platform QR). Technician wallet adjusted.`
            });
            await booking.save();
            console.log(`  ✅ Updated booking: paymentCollectedBy=Platform, paymentMethod=Online`);
        }

        // Step 6: Save corrected wallet balance
        await tech.save();
        console.log(`\n=== FINAL STATE ===`);
        console.log(`Technician: ${tech.name}`);
        console.log(`Corrected wallet balance: ₹${tech.walletBalance}`);

        // Verify with full ledger
        const allLedger = await FinancialLedger.find({ userId: techId }).sort({ createdAt: 1 }).lean();
        console.log(`\n=== CORRECTED LEDGER (${allLedger.length} entries) ===`);
        for (const entry of allLedger) {
            console.log(`  ${entry.createdAt.toISOString().slice(0,19)} | ${entry.type.padEnd(22)} | ${entry.amount >= 0 ? '+' : ''}₹${entry.amount} | Balance: ₹${entry.balanceAfter} | ${entry.description.slice(0, 90)} | Ref: ${entry.referenceId}`);
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await mongoose.disconnect();
    }
}

fix();
