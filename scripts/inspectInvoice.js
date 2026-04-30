/**
 * Debug: Inspect invoice items
 * Run: node scripts/inspectInvoice.js INV-2026-034
 */
require('dotenv').config();
const mongoose = require('mongoose');
require('../models/Invoice');

async function run() {
    await mongoose.connect(process.env.MONGO_URI);
    const Invoice = mongoose.model('Invoice');

    const inv = await Invoice.findOne({ invoiceId: process.argv[2] });
    if (!inv) { console.log('Invoice not found'); process.exit(1); }

    console.log('\n=== INVOICE ===');
    console.log('invoiceId  :', inv.invoiceId);
    console.log('subtotal   :', inv.subtotal);
    console.log('totalCGST  :', inv.totalCGST);
    console.log('totalSGST  :', inv.totalSGST);
    console.log('grandTotal :', inv.totalAmount);
    console.log('pointsUsed :', inv.pointsUsed);
    console.log('\nITEMS:');
    inv.items.forEach((it, i) => console.log(`  [${i}] ${it.description} | taxable:${it.taxableValue} | disc:${it.discountShare} | cgst:${it.cgstAmount} | sgst:${it.sgstAmount} | total:${it.total}`));

    await mongoose.disconnect();
}
run().catch(err => { console.error(err); process.exit(1); });
