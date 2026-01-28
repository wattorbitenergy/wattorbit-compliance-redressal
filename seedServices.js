/**
 * Seed script to populate sample services and packages
 * Run: node backend/seedServices.js
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const mongoose = require('mongoose');
const Service = require('./models/Service');
const ServicePackage = require('./models/ServicePackage');
const { generateServiceId, generatePackageId } = require('./utils/idGenerator');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/wcrm_dev';

const sampleServices = [
    {
        name: 'AC Repair & Servicing',
        description: 'Professional air conditioning repair and maintenance services. Our expert technicians will diagnose and fix any AC issues, perform regular maintenance, and ensure optimal cooling performance.',
        category: 'Home Appliances',
        subcategory: 'Air Conditioning',
        basePrice: 499,
        duration: 60,
        tags: ['AC', 'Cooling', 'Maintenance', 'Repair'],
        availableCities: ['Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Chennai'],
        packages: [
            {
                name: 'Basic',
                description: 'Basic AC inspection and gas check',
                price: 499,
                duration: 60,
                features: [
                    'Visual inspection',
                    'Gas pressure check',
                    'Filter cleaning',
                    'Basic troubleshooting'
                ]
            },
            {
                name: 'Standard',
                description: 'Complete AC servicing with gas refill',
                price: 999,
                duration: 90,
                features: [
                    'All Basic features',
                    'Gas refill (if needed)',
                    'Coil cleaning',
                    'Drainage cleaning',
                    '1-month warranty'
                ],
                isPopular: true
            },
            {
                name: 'Premium',
                description: 'Deep cleaning and complete maintenance',
                price: 1499,
                duration: 120,
                features: [
                    'All Standard features',
                    'Deep coil cleaning',
                    'Anti-rust treatment',
                    'Performance optimization',
                    '3-month warranty',
                    'Free follow-up visit'
                ]
            }
        ]
    },
    {
        name: 'Electrical Wiring & Repair',
        description: 'Expert electrical services for homes and offices. From wiring installations to fault repairs, our licensed electricians ensure safe and reliable electrical systems.',
        category: 'Electrical',
        subcategory: 'Wiring',
        basePrice: 299,
        duration: 45,
        tags: ['Electrical', 'Wiring', 'Repair', 'Installation'],
        availableCities: ['Mumbai', 'Delhi', 'Bangalore', 'Pune', 'Hyderabad'],
        packages: [
            {
                name: 'Basic',
                description: 'Minor electrical repairs and fixes',
                price: 299,
                duration: 45,
                features: [
                    'Switch/socket replacement',
                    'Bulb/tube light installation',
                    'Minor wiring fixes',
                    'Safety inspection'
                ]
            },
            {
                name: 'Standard',
                description: 'Complete electrical troubleshooting',
                price: 699,
                duration: 90,
                features: [
                    'All Basic features',
                    'Circuit testing',
                    'MCB replacement',
                    'Earthing check',
                    'Load balancing'
                ],
                isPopular: true
            }
        ]
    },
    {
        name: 'Plumbing Services',
        description: 'Professional plumbing solutions for all your needs. Leakage repairs, pipe installations, drainage cleaning, and more by experienced plumbers.',
        category: 'Plumbing',
        subcategory: 'General Plumbing',
        basePrice: 349,
        duration: 60,
        tags: ['Plumbing', 'Leakage', 'Pipes', 'Drainage'],
        availableCities: ['Mumbai', 'Delhi', 'Bangalore', 'Chennai', 'Kolkata'],
        packages: [
            {
                name: 'Basic',
                description: 'Basic plumbing repairs',
                price: 349,
                duration: 60,
                features: [
                    'Tap repair/replacement',
                    'Minor leakage fixes',
                    'Flush repair',
                    'Basic inspection'
                ]
            },
            {
                name: 'Standard',
                description: 'Complete plumbing service',
                price: 799,
                duration: 120,
                features: [
                    'All Basic features',
                    'Pipe installation',
                    'Drainage cleaning',
                    'Water pressure check',
                    'Blockage removal'
                ],
                isPopular: true
            }
        ]
    },
    {
        name: 'Home Deep Cleaning',
        description: 'Thorough deep cleaning services for your entire home. Our trained professionals use eco-friendly products to ensure a spotless and hygienic living space.',
        category: 'Cleaning',
        subcategory: 'Deep Cleaning',
        basePrice: 1999,
        duration: 240,
        tags: ['Cleaning', 'Deep Clean', 'Sanitization', 'Home Care'],
        availableCities: ['Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Pune'],
        packages: [
            {
                name: 'Basic',
                description: '2BHK deep cleaning',
                price: 1999,
                duration: 240,
                features: [
                    'Kitchen deep cleaning',
                    'Bathroom sanitization',
                    'Living room cleaning',
                    '2 bedrooms cleaning',
                    'Balcony cleaning'
                ]
            },
            {
                name: 'Standard',
                description: '3BHK deep cleaning',
                price: 2999,
                duration: 300,
                features: [
                    'All Basic features',
                    '3 bedrooms cleaning',
                    'Sofa cleaning',
                    'Window cleaning',
                    'Appliance exterior cleaning'
                ],
                isPopular: true
            },
            {
                name: 'Premium',
                description: '4BHK+ complete home cleaning',
                price: 4499,
                duration: 420,
                features: [
                    'All Standard features',
                    '4+ bedrooms cleaning',
                    'Carpet shampooing',
                    'Curtain cleaning',
                    'Pest control treatment',
                    'Air purification'
                ]
            }
        ]
    },
    {
        name: 'Washing Machine Repair',
        description: 'Expert washing machine repair services for all brands. Quick diagnosis and repair of common issues like drainage problems, spin issues, and more.',
        category: 'Home Appliances',
        subcategory: 'Washing Machine',
        basePrice: 399,
        duration: 75,
        tags: ['Washing Machine', 'Repair', 'Appliance', 'Maintenance'],
        availableCities: ['Mumbai', 'Delhi', 'Bangalore', 'Chennai', 'Hyderabad'],
        packages: [
            {
                name: 'Basic',
                description: 'Diagnosis and minor repairs',
                price: 399,
                duration: 75,
                features: [
                    'Problem diagnosis',
                    'Minor repairs',
                    'Cleaning and maintenance',
                    'Performance check'
                ],
                isPopular: true
            },
            {
                name: 'Standard',
                description: 'Complete repair with parts',
                price: 899,
                duration: 120,
                features: [
                    'All Basic features',
                    'Parts replacement (if needed)',
                    'Deep cleaning',
                    'Warranty on service',
                    'Follow-up support'
                ]
            }
        ]
    }
];

async function seedServices() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB');

        // Clear existing services and packages
        console.log('Clearing existing services and packages...');
        await Service.deleteMany({});
        await ServicePackage.deleteMany({});
        console.log('Cleared existing data');

        // Create services and packages
        for (const serviceData of sampleServices) {
            const { packages, ...serviceInfo } = serviceData;

            // Generate service ID
            const serviceId = await generateServiceId();

            // Create service
            const service = new Service({
                serviceId,
                ...serviceInfo,
                createdBy: null // Will be set to admin user in production
            });

            await service.save();
            console.log(`✓ Created service: ${service.name} (${service.serviceId})`);

            // Create packages for this service
            for (const packageData of packages) {
                const packageId = await generatePackageId();

                const servicePackage = new ServicePackage({
                    packageId,
                    serviceId: service._id,
                    ...packageData
                });

                await servicePackage.save();
                console.log(`  ✓ Created package: ${servicePackage.name} - ₹${servicePackage.price}`);
            }
        }

        console.log('\n✅ Successfully seeded services and packages!');
        console.log(`Total services created: ${sampleServices.length}`);

        const totalPackages = sampleServices.reduce((sum, s) => sum + s.packages.length, 0);
        console.log(`Total packages created: ${totalPackages}`);

        process.exit(0);
    } catch (err) {
        console.error('❌ Error seeding services:', err);
        process.exit(1);
    }
}

seedServices();
