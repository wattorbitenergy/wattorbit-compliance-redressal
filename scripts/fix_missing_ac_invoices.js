const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Invoice = require('../models/Invoice');
const User = require('../models/User');
const Service = require('../models/Service');
const ServicePackage = require('../models/ServicePackage');
const Address = require('../models/Address');
const { autoGenerateInvoice } = require('../utils/invoiceHelper');
require('dotenv').config();

async function run() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to database');

        // Find AC Service ID
        const acService = await Service.findOne({ name: /AC/i });
        if (!acService) {
            console.error('AC Service not found');
            return;
        }
        console.log(`AC Service ID: ${acService._id} (${acService.name})`);

        // Find completed AC service bookings without invoices
        const bookings = await Booking.find({
            status: 'Completed',
            serviceId: acService._id
        }).sort({ completedAt: -1 });

        console.log(`Found ${bookings.length} completed AC service bookings`);

        let fixedCount = 0;
        for (const booking of bookings) {
            const existingInvoice = await Invoice.findOne({ bookingId: booking._id });
            if (existingInvoice) {
                console.log(`Re-generating invoice for Booking ID: ${booking.bookingId}...`);
                await Invoice.deleteOne({ _id: existingInvoice._id });
            } else {
                console.log(`Generating missing invoice for Booking ID: ${booking.bookingId}...`);
            }
            
            const invoice = await autoGenerateInvoice(booking._id);
            if (invoice) {
                console.log(`✅ Invoice: ${invoice.invoiceId}`);
                fixedCount++;
            } else {
                console.log(`❌ Failed to generate invoice for ${booking.bookingId}`);
            }
        }

        console.log(`Finished. Generated ${fixedCount} invoices.`);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await mongoose.disconnect();
    }
}

run();
