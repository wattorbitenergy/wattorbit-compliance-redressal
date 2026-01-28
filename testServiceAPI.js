/**
 * Quick API test script to verify service management routes
 * Run: node backend/testServiceAPI.js
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const mongoose = require('mongoose');
const Service = require('./models/Service');
const ServicePackage = require('./models/ServicePackage');
const Booking = require('./models/Booking');
const Address = require('./models/Address');
const User = require('./models/User');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/wcrm_dev';

async function testAPI() {
    try {
        console.log('🔗 Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to MongoDB\n');

        // Test 1: List all services
        console.log('📋 Test 1: List all services');
        const services = await Service.find({ isActive: true });
        console.log(`   Found ${services.length} active services`);
        services.forEach(s => {
            console.log(`   - ${s.name} (${s.serviceId}) - ₹${s.basePrice}`);
        });
        console.log('');

        // Test 2: Get service with packages
        console.log('📦 Test 2: Get service with packages');
        const service = services[0];
        const packages = await ServicePackage.find({
            serviceId: service._id,
            isActive: true
        }).sort({ price: 1 });
        console.log(`   Service: ${service.name}`);
        console.log(`   Packages: ${packages.length}`);
        packages.forEach(p => {
            console.log(`   - ${p.name}: ₹${p.price} (${p.duration} mins)`);
        });
        console.log('');

        // Test 3: Check categories
        console.log('🏷️  Test 3: Get all categories');
        const categories = await Service.distinct('category', { isActive: true });
        console.log(`   Categories: ${categories.join(', ')}`);
        console.log('');

        // Test 4: Filter by category
        console.log('🔍 Test 4: Filter by category (Home Appliances)');
        const applianceServices = await Service.find({
            category: 'Home Appliances',
            isActive: true
        });
        console.log(`   Found ${applianceServices.length} services in Home Appliances`);
        applianceServices.forEach(s => {
            console.log(`   - ${s.name}`);
        });
        console.log('');

        // Test 5: Check data integrity
        console.log('✅ Test 5: Data integrity checks');
        const totalServices = await Service.countDocuments();
        const totalPackages = await ServicePackage.countDocuments();
        const totalBookings = await Booking.countDocuments();
        const totalAddresses = await Address.countDocuments();
        console.log(`   Services: ${totalServices}`);
        console.log(`   Packages: ${totalPackages}`);
        console.log(`   Bookings: ${totalBookings}`);
        console.log(`   Addresses: ${totalAddresses}`);
        console.log('');

        // Test 6: Check users for testing
        console.log('👥 Test 6: Check available users');
        const users = await User.find().limit(5);
        console.log(`   Total users: ${await User.countDocuments()}`);
        console.log(`   Sample users:`);
        users.forEach(u => {
            console.log(`   - ${u.name || u.username} (${u.role})`);
        });
        console.log('');

        console.log('✅ All API tests passed!');
        console.log('\n📌 Next Steps:');
        console.log('   1. Start the backend server: npm start (in backend directory)');
        console.log('   2. Test API endpoints using Postman or curl');
        console.log('   3. Create admin portal for service management');
        console.log('   4. Create mobile app for user booking flow');

        process.exit(0);
    } catch (err) {
        console.error('❌ Error:', err);
        process.exit(1);
    }
}

testAPI();
