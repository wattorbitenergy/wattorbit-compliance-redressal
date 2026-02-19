const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const Invoice = require('../models/Invoice');
const Booking = require('../models/Booking');

async function migrateInvoices() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const invoices = await Invoice.find();
        console.log(`Found ${invoices.length} invoices to migrate`);

        for (const inv of invoices) {
            // Update items to reflect Technician Charges
            if (inv.items && inv.items.length > 0) {
                inv.items = inv.items.map(item => {
                    if (!item.description.includes('Technician Charges')) {
                        item.description = `Technician Charges (${item.description})`;
                    }
                    return item;
                });
            }

            // Set platform fee = 0 logic implies tax = 0 on old invoices
            const originalSubtotal = inv.subtotal;
            inv.taxAmount = 0;
            inv.totalAmount = originalSubtotal;

            await inv.save();
            console.log(`Migrated invoice: ${inv.invoiceId}`);

            // Also update the linked booking if exists to stay consistent
            if (inv.bookingId) {
                const booking = await Booking.findById(inv.bookingId);
                if (booking) {
                    booking.taxes = 0;
                    booking.totalAmount = booking.basePrice;
                    booking.technicianCharges = booking.basePrice;
                    booking.platformFees = 0;
                    await booking.save();
                    console.log(`Updated consistency for booking: ${booking.bookingId}`);
                }
            }
        }

        console.log('Invoice migration completed successfully');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrateInvoices();
