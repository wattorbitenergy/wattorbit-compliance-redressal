/**
 * One-time script: Regenerate invoice for a booking directly by bookingId (ObjectId or bookingRef)
 * Usage:
 *   node scripts/regenerateInvoice.js <invoiceId>          -- find booking via invoice
 *   node scripts/regenerateInvoice.js --booking <bookingId> -- use booking ObjectId directly
 *   node scripts/regenerateInvoice.js --ref <bookingRef>    -- use booking ref e.g. WO-2026-001
 */
require('dotenv').config();
const mongoose = require('mongoose');

// Pre-register all models that populate() needs
require('../models/User');
require('../models/Service');
require('../models/ServicePackage');
require('../models/Address');
require('../models/Coupon');
require('../models/Payment');
require('../models/Invoice');
require('../models/Booking');

async function run() {
    const arg1 = process.argv[2];
    const arg2 = process.argv[3];

    if (!arg1) {
        console.error('Usage:\n  node scripts/regenerateInvoice.js <invoiceId>\n  node scripts/regenerateInvoice.js --booking <ObjectId>\n  node scripts/regenerateInvoice.js --ref <bookingRef>');
        process.exit(1);
    }

    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected.\n');

    const Invoice  = mongoose.model('Invoice');
    const Booking  = mongoose.model('Booking');
    const { autoGenerateInvoice } = require('../utils/invoiceHelper');

    let bookingId = null;

    if (arg1 === '--booking' && arg2) {
        // Direct ObjectId
        bookingId = arg2;
        console.log(`📌 Mode: direct bookingId = ${bookingId}`);

    } else if (arg1 === '--ref' && arg2) {
        // Human-readable booking ref e.g. WO-2026-032
        const booking = await Booking.findOne({ bookingId: arg2 });
        if (!booking) { console.error(`❌ No booking found with ref ${arg2}`); process.exit(1); }
        bookingId = booking._id.toString();
        console.log(`📌 Mode: booking ref ${arg2} → ObjectId ${bookingId}`);

    } else {
        // Invoice ID mode — delete existing invoice first if it exists
        const existing = await Invoice.findOne({ invoiceId: arg1 });
        if (existing) {
            bookingId = existing.bookingId.toString();
            console.log(`📄 Found invoice: ${arg1}`);
            console.log(`   Booking ID   : ${bookingId}`);
            console.log(`   Customer     : ${existing.customerName}`);
            console.log(`   Old Total    : ₹${existing.totalAmount}`);
            await Invoice.deleteOne({ invoiceId: arg1 });
            console.log(`🗑️  Deleted old invoice ${arg1}\n`);
        } else {
            // Invoice already deleted — find booking by ref (strip prefix: INV- → WO- mapping)
            // Try to find booking by matching the number suffix
            const suffix = arg1.replace('INV-', '').replace(/^(\d{4})-/, '$1-');
            const bookingRef = 'WO-' + suffix;
            console.log(`⚠️  Invoice ${arg1} not found. Searching for booking ref: ${bookingRef}`);
            const booking = await Booking.findOne({ bookingId: bookingRef });
            if (!booking) {
                console.error(`❌ Could not find booking for invoice ${arg1}. Try: node scripts/regenerateInvoice.js --ref WO-XXXX-XXX`);
                await mongoose.disconnect();
                process.exit(1);
            }
            bookingId = booking._id.toString();
            console.log(`📌 Found booking ${bookingRef} → ObjectId ${bookingId}\n`);
        }
    }

    // Delete any stale invoice for this booking (safety net)
    const stale = await Invoice.findOne({ bookingId });
    if (stale) {
        await Invoice.deleteOne({ bookingId });
        console.log(`🗑️  Removed stale invoice ${stale.invoiceId} for this booking.`);
    }

    console.log('⚙️  Regenerating invoice with fixed logic...');
    const newInvoice = await autoGenerateInvoice(bookingId);

    if (!newInvoice) {
        console.error('❌ Regeneration failed. See errors above.');
        await mongoose.disconnect();
        process.exit(1);
    }

    console.log('\n✅ Invoice regenerated successfully!');
    console.log('─'.repeat(45));
    console.log(`   New Invoice ID    : ${newInvoice.invoiceId}`);
    console.log(`   Booking Ref       : ${newInvoice.bookingRef || 'N/A'}`);
    console.log(`   Customer          : ${newInvoice.customerName}`);
    console.log(`   Subtotal          : ₹${newInvoice.subtotal}`);
    console.log(`   Total CGST        : ₹${newInvoice.totalCGST}`);
    console.log(`   Total SGST        : ₹${newInvoice.totalSGST}`);
    console.log(`   Total IGST        : ₹${newInvoice.totalIGST}`);
    console.log(`   Discount          : ₹${newInvoice.discount}`);
    console.log(`   Platform Discount : ₹${newInvoice.platformDiscountShare}`);
    console.log(`   Tech Discount     : ₹${newInvoice.technicianDiscountShare}`);
    console.log(`   Grand Total       : ₹${newInvoice.totalAmount}`);
    console.log('─'.repeat(45));
    console.log(`\n📥 Download via: GET /api/invoices/${newInvoice._id}/download`);

    await mongoose.disconnect();
    console.log('\n🔌 Disconnected. Done.');
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
