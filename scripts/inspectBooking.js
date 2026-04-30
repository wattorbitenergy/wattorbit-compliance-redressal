/**
 * Debug: Inspect booking data for invoice regeneration
 * Run: node scripts/inspectBooking.js <bookingObjectId>
 */
require('dotenv').config();
const mongoose = require('mongoose');
require('../models/User');
require('../models/Service');
require('../models/ServicePackage');
require('../models/Address');
require('../models/Coupon');
require('../models/Payment');
require('../models/Invoice');
require('../models/Booking');

async function run() {
    await mongoose.connect(process.env.MONGO_URI);
    const Booking = mongoose.model('Booking');
    const Invoice = mongoose.model('Invoice');

    const bookingId = process.argv[2] || '69edade389d5c087087f1135';
    const booking = await Booking.findById(bookingId)
        .populate('userId', 'name phone')
        .populate('serviceId', 'name')
        .populate('packageId', 'name sacCode')
        .populate('addressId');

    if (!booking) { console.log('Booking not found'); process.exit(1); }

    console.log('\n=== BOOKING SUMMARY ===');
    console.log('Ref          :', booking.bookingId);
    console.log('techCharges  :', booking.technicianCharges);
    console.log('platformFees :', booking.platformFees);
    console.log('discount     :', booking.discount);
    console.log('platformShare:', booking.platformDiscountShare);
    console.log('techShare    :', booking.technicianDiscountShare);
    console.log('pointsUsed   :', booking.pointsUsed);
    console.log('totalAmount  :', booking.totalAmount);
    console.log('taxes        :', booking.taxes);
    console.log('\n=== SERVICES ARRAY ===');
    if (booking.services && booking.services.length > 0) {
        booking.services.forEach((s, i) => {
            console.log(`[${i}] name:${s.name} techFee:${s.technicianCharges} platFee:${s.platformFees} discount:${s.discount} finalPrice:${s.finalPrice} isAdditional:${s.isAdditional}`);
        });
    } else {
        console.log('(empty — single service via serviceId/packageId)');
        console.log('serviceId:', booking.serviceId?.name);
        console.log('packageId:', booking.packageId?.name, '| sacCode:', booking.packageId?.sacCode);
    }

    console.log('\n=== MATERIALS ===');
    if (booking.materialsUsed && booking.materialsUsed.length > 0) {
        booking.materialsUsed.forEach((m, i) => console.log(`[${i}]`, m.name, m.quantity, m.sellingPrice));
    } else { console.log('(none)'); }

    const inv = await Invoice.findOne({ bookingId });
    console.log('\n=== INVOICE ===');
    if (inv) {
        console.log('invoiceId  :', inv.invoiceId);
        console.log('bookingRef :', inv.bookingRef);
        console.log('totalCGST  :', inv.totalCGST);
        console.log('totalSGST  :', inv.totalSGST);
        console.log('items:');
        inv.items.forEach((it, i) => console.log(`  [${i}] ${it.description} | taxable:${it.taxableValue} | disc:${it.discountShare} | cgst:${it.cgstAmount} | sgst:${it.sgstAmount} | total:${it.total}`));
    } else { console.log('(no invoice found)'); }

    await mongoose.disconnect();
}
run().catch(err => { console.error(err); process.exit(1); });
