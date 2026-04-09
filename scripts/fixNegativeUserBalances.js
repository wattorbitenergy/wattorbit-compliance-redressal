/**
 * ONE-TIME FIX SCRIPT: Rectify negative wallet balances for non-technician users.
 * 
 * Run with: node backend/scripts/fixNegativeUserBalances.js
 * 
 * Context: A bug allowed user (customer) wallet balances to go negative
 * if points redemption was applied in an edge case. Technicians are excluded
 * because they LEGITIMATELY have negative balances (commission owed to platform).
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const FinancialLedger = require('../models/FinancialLedger');

async function fixNegativeBalances() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');

        // Find all non-technician users with negative wallet balances
        const affected = await User.find({
            role: { $ne: 'technician' },
            walletBalance: { $lt: 0 }
        }).select('_id name username role walletBalance');

        if (affected.length === 0) {
            console.log('✅ No affected users found. All balances are clean.');
            process.exit(0);
        }

        console.log(`⚠️  Found ${affected.length} user(s) with negative balances:\n`);
        affected.forEach(u => {
            console.log(`  - [${u.role}] ${u.username || u.name} → Balance: ${u.walletBalance}`);
        });

        // Fix each user
        for (const user of affected) {
            const oldBalance = user.walletBalance;
            user.walletBalance = 0;
            await user.save();

            // Record the correction in the ledger for audit
            await FinancialLedger.create({
                userId: user._id,
                type: 'ADJUSTMENT',
                amount: Math.abs(oldBalance), // Positive correction
                description: `[SYSTEM CORRECTION] Negative balance rectified. Previous: ₹${oldBalance}. Reason: Non-technician users cannot have negative balances.`,
                balanceAfter: 0,
                referenceId: `FIX_${Date.now()}`,
                isDemo: false,
                metadata: { correctedBy: 'SYSTEM', originalBalance: oldBalance }
            });

            console.log(`  ✅ Fixed ${user.username}: ${oldBalance} → 0 (correction logged in ledger)`);
        }

        console.log(`\n✅ Done. Fixed ${affected.length} user(s). Ledger corrections recorded.`);
        process.exit(0);
    } catch (err) {
        console.error('❌ Fix script failed:', err);
        process.exit(1);
    }
}

fixNegativeBalances();
