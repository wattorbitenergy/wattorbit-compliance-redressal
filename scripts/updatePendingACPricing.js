const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const Booking = require('../models/Booking');
const Service = require('../models/Service');
const Coupon = require('../models/Coupon');
const { round } = require('../utils/mathUtils');

async function updatePendingACPricing() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        // 1. Find all bookings with status 'Pending' for AC services
        // We look for bookings where the service name contains 'AC' or the service object matches
        const bookings = await Booking.find({ 
            status: 'Pending'
        }).populate('serviceId');

        const acBookings = bookings.filter(b => 
            b.serviceId && b.serviceId.name && b.serviceId.name.toUpperCase().includes('AC')
        );

        console.log(`Found ${acBookings.length} pending AC bookings to process.`);

        for (const booking of acBookings) {
            console.log(`\nProcessing Booking: ${booking.bookingId || booking._id}`);
            console.log(`Old Pricing - Tech: ${booking.technicianCharges}, Plat: ${booking.platformFees}, Base: ${booking.basePrice}, Total: ${booking.totalAmount}`);

            const newTechCharges = 490;
            const newPlatformFees = 69;
            const newBasePrice = newTechCharges + newPlatformFees;

            // Update main booking fields
            booking.technicianCharges = newTechCharges;
            booking.platformFees = newPlatformFees;
            booking.basePrice = newBasePrice;

            // Recalculate discounts and taxes
            let discount = 0;
            let technicianDiscountShare = 0;
            let platformDiscountShare = 0;

            if (booking.couponCode) {
                const coupon = await Coupon.findOne({ code: booking.couponCode.toUpperCase() });
                if (coupon) {
                    discount = coupon.calculateDiscount(newBasePrice);
                    
                    if (coupon.technicianAbsorbsPercent !== null && typeof coupon.technicianAbsorbsPercent !== 'undefined') {
                        technicianDiscountShare = round((discount * coupon.technicianAbsorbsPercent) / 100);
                        platformDiscountShare = round(discount - technicianDiscountShare);
                    } else {
                        // Default to platform absorbing everything if not specified
                        platformDiscountShare = discount;
                    }
                    console.log(`Applied Coupon ${booking.couponCode}: Discount ₹${discount} (Tech: ${technicianDiscountShare}, Plat: ${platformDiscountShare})`);
                }
            }

            booking.discount = discount;
            booking.technicianDiscountShare = technicianDiscountShare;
            booking.platformDiscountShare = platformDiscountShare;

            // Taxes: 18% on net platform fee
            const netPlatformFees = round(newPlatformFees - platformDiscountShare);
            const taxes = Math.max(0, round((netPlatformFees * 18) / 100));
            booking.taxes = taxes;

            // Total Amount
            const pointsUsed = booking.pointsUsed || 0;
            booking.totalAmount = Math.max(0, round(newBasePrice + taxes - discount - pointsUsed));

            // Update services array (line items)
            if (booking.services && booking.services.length > 0) {
                const firstService = booking.services[0];
                firstService.technicianCharges = newTechCharges;
                firstService.platformFees = newPlatformFees;
                firstService.basePrice = newBasePrice;
                firstService.discount = discount;
                firstService.finalPrice = booking.totalAmount;
            }

            // Status history note
            booking.statusHistory.push({
                status: booking.status,
                timestamp: new Date(),
                notes: `Pricing updated to ₹490 (Tech) / ₹69 (Plat) as per system update.`
            });

            await booking.save();
            console.log(`Updated Pricing - Tech: ${booking.technicianCharges}, Plat: ${booking.platformFees}, Base: ${booking.basePrice}, Total: ${booking.totalAmount}, Tax: ${booking.taxes}`);
        }

        console.log('\nMigration completed successfully!');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

updatePendingACPricing();
