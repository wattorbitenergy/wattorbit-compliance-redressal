const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const ServicePackage = require('../models/ServicePackage');
const Booking = require('../models/Booking');

async function migrate() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        // Migrate ServicePackages
        const packages = await ServicePackage.find({
            $or: [
                { technicianCharges: { $exists: false } },
                { platformFees: { $exists: false } },
                { technicianCharges: 0, platformFees: 0 }
            ]
        });

        console.log(`Found ${packages.length} packages to migrate`);

        for (const pkg of packages) {
            // Assume 90% technician, 10% platform as a starting point or just set Tech = Price
            // Setting Tech = Price and Plat = 0 for safety (no price change)
            pkg.technicianCharges = pkg.price;
            pkg.platformFees = 0;
            await pkg.save();
            console.log(`Migrated package: ${pkg.name}`);
        }

        // Migrate Bookings
        const bookings = await Booking.find({
            $or: [
                { technicianCharges: { $exists: false } },
                { platformFees: { $exists: false } }
            ]
        });

        console.log(`Found ${bookings.length} bookings to migrate`);

        for (const booking of bookings) {
            booking.technicianCharges = booking.basePrice;
            booking.platformFees = 0;
            await booking.save();
            console.log(`Migrated booking: ${booking.bookingId}`);
        }

        console.log('Migration completed successfully');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
