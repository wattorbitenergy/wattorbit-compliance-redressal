const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const TechnicianEarning = require('../models/TechnicianEarning');
const FinancialLedger = require('../models/FinancialLedger');
const User = require('../models/User');
require('dotenv').config();

async function audit() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to database\n');

        // 1. Get bookings 59 and 60
        const targetBookings = await Booking.find({
            bookingId: { $in: ['BKG-2026-0059', 'BKG-2026-0060'] }
        }).populate('assignedTechnician', 'name phone walletBalance').lean();

        console.log('=== BOOKING DETAILS ===');
        for (const b of targetBookings) {
            console.log(`\n--- ${b.bookingId} ---`);
            console.log(`  Status: ${b.status}`);
            console.log(`  Technician: ${b.assignedTechnician?.name} (${b.assignedTechnician?._id})`);
            console.log(`  Payment Method: ${b.paymentMethod}`);
            console.log(`  Payment Collected By: ${b.paymentCollectedBy || 'NOT SET'}`);
            console.log(`  Payment Received: ${b.paymentReceived}`);
            console.log(`  Payment Status: ${b.paymentStatus}`);
            console.log(`  Technician Charges: ₹${b.technicianCharges}`);
            console.log(`  Platform Fees: ₹${b.platformFees}`);
            console.log(`  Taxes: ₹${b.taxes}`);
            console.log(`  Discount: ₹${b.discount}`);
            console.log(`  Tech Discount Share: ₹${b.technicianDiscountShare}`);
            console.log(`  Platform Discount Share: ₹${b.platformDiscountShare}`);
            console.log(`  Total Amount: ₹${b.totalAmount}`);
            console.log(`  Base Price: ₹${b.basePrice}`);
            console.log(`  Coupon Code: ${b.couponCode || 'NONE'}`);
            console.log(`  Completed At: ${b.completedAt}`);
        }

        // 2. Get the technician ID (Uttam Kumar)
        const techId = targetBookings[0]?.assignedTechnician?._id;
        if (!techId) {
            console.log('\nNo technician found!');
            return;
        }

        const tech = await User.findById(techId);
        console.log(`\n=== TECHNICIAN: ${tech.name} ===`);
        console.log(`  Current Wallet Balance: ₹${tech.walletBalance}`);

        // 3. Get ALL earning records for this technician
        const allEarnings = await TechnicianEarning.find({ technicianId: techId })
            .populate('bookingId', 'bookingId paymentMethod paymentCollectedBy')
            .sort({ createdAt: 1 }).lean();
        
        console.log(`\n=== ALL EARNING RECORDS (${allEarnings.length}) ===`);
        for (const e of allEarnings) {
            console.log(`  ${e.bookingId?.bookingId || 'UNKNOWN'} | Share: ₹${e.technicianShare} | Platform: ₹${e.platformFee} | Tax: ₹${e.taxAmount} | Total: ₹${e.totalAmount} | Status: ${e.status} | Demo: ${e.isDemo} | Notes: ${e.notes}`);
        }

        // 4. Get ALL ledger entries for this technician
        const allLedger = await FinancialLedger.find({ userId: techId })
            .sort({ createdAt: 1 }).lean();
        
        console.log(`\n=== FULL FINANCIAL LEDGER (${allLedger.length} entries) ===`);
        let runningBalance = 0;
        for (const entry of allLedger) {
            runningBalance += entry.amount;
            const match = runningBalance === entry.balanceAfter ? '✅' : `❌ EXPECTED ${runningBalance}`;
            console.log(`  ${entry.createdAt.toISOString().slice(0,19)} | ${entry.type.padEnd(22)} | ${entry.amount >= 0 ? '+' : ''}₹${entry.amount} | Balance: ₹${entry.balanceAfter} ${match} | ${entry.description.slice(0, 80)} | Ref: ${entry.referenceId} | Demo: ${entry.isDemo}`);
        }
        console.log(`\n  CALCULATED BALANCE: ₹${runningBalance}`);
        console.log(`  ACTUAL BALANCE:     ₹${tech.walletBalance}`);
        console.log(`  MATCH: ${runningBalance === tech.walletBalance ? '✅ YES' : '❌ NO — MISMATCH!'}`);

        // 5. Check what SHOULD have happened for bookings 59 and 60
        console.log('\n=== EXPECTED BEHAVIOR FOR BKG-59 & BKG-60 ===');
        for (const b of targetBookings) {
            const techShare = Math.max(0, (b.technicianCharges || 0) - (b.technicianDiscountShare || 0));
            const netPlatformFees = Math.max(0, (b.platformFees || 0) - (b.platformDiscountShare || 0));
            const platformPortion = netPlatformFees + (b.taxes || 0);

            const isDeduction = b.paymentCollectedBy === 'Technician' || 
                               (!b.paymentCollectedBy && (b.paymentMethod === 'COD' || !b.paymentMethod));
            
            console.log(`\n  ${b.bookingId}:`);
            console.log(`    Tech Share (after discount): ₹${techShare}`);
            console.log(`    Platform Portion (fees + tax): ₹${platformPortion}`);
            console.log(`    Payment collected by: ${b.paymentCollectedBy || 'NOT SET (fallback: ' + (isDeduction ? 'Technician/COD' : 'Platform') + ')'}`);
            console.log(`    Action: ${isDeduction ? 'COMMISSION_DEDUCTION -₹' + platformPortion : 'EARNING +₹' + techShare}`);
            console.log(`    CORRECT (online to company QR = Platform): EARNING +₹${techShare}`);
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await mongoose.disconnect();
    }
}

audit();
