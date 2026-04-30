const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const Booking = require('../models/Booking');

async function fixBookingTotals() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        // Find bookings that have materials and are not cancelled
        const bookings = await Booking.find({ 
            materialsUsed: { $exists: true, $not: { $size: 0 } },
            status: { $nin: ['Cancelled'] }
        });

        console.log(`Found ${bookings.length} bookings with materials.`);
        let updatedCount = 0;

        for (const booking of bookings) {
            const materialTotal = booking.materialTotal || 0;
            const materialTaxTotal = booking.materialTaxTotal || 0;
            const basePrice = booking.basePrice || 0;
            const taxes = booking.taxes || 0;
            const discount = booking.discount || 0;
            const lineItemDiscount = booking.lineItemDiscount || 0;
            const pointsUsed = booking.pointsUsed || 0;

            const expectedTotal = Math.max(0, basePrice + taxes + materialTotal + materialTaxTotal - discount - lineItemDiscount - pointsUsed);

            if (booking.totalAmount !== expectedTotal) {
                console.log(`Booking ${booking.bookingId}: Expected ${expectedTotal}, found ${booking.totalAmount}. Updating...`);
                booking.totalAmount = expectedTotal;
                await booking.save();
                updatedCount++;
            }
        }

        console.log(`Successfully updated ${updatedCount} bookings.`);
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

fixBookingTotals();
