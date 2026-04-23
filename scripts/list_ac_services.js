const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const Service = require('../models/Service');
const ServicePackage = require('../models/ServicePackage');

async function listACServices() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const services = await Service.find({ name: /AC/i });
        console.log(`Found ${services.length} services matching "AC":`);
        for (const s of services) {
            console.log(`- Service: ${s.name} (${s._id})`);
            const packages = await ServicePackage.find({ serviceId: s._id });
            for (const p of packages) {
                console.log(`  * Package: ${p.name} (Tech: ${p.technicianCharges}, Plat: ${p.platformFees}, Total: ${p.price})`);
            }
        }

        process.exit(0);
    } catch (err) {
        console.error('Failed:', err);
        process.exit(1);
    }
}

listACServices();
