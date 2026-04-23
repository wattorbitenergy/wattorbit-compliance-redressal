const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const Booking = require('../models/Booking');

async function checkPendingACBookings() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const serviceId = '6978ddc798bd9673bac412dc';
        const bookings = await Booking.find({ 
            status: 'Pending',
            serviceId: serviceId
        });

        console.log(`Found ${bookings.length} pending bookings for AC service:`);
        for (const b of bookings) {
            console.log(`- Booking ${b.bookingId || b._id}: Tech: ${b.technicianCharges}, Plat: ${b.platformFees}, Tax: ${b.taxes}, Total: ${b.totalAmount}, Coupon: ${b.couponCode || 'None'}`);
        }

        process.exit(0);
    } catch (err) {
        console.error('Failed:', err);
        process.exit(1);
    }
}

checkPendingACBookings();
