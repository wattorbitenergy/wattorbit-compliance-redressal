const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const Category = require('../models/Category');

const categories = [
    { name: 'Electrical', icon: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?q=80&w=2069&auto=format&fit=crop', order: 1, description: 'All electrical repairs and installations' },
    { name: 'Plumbing', icon: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?q=80&w=2070&auto=format&fit=crop', order: 2, description: 'Fix leaks, pipes, and bathroom fittings' },
    { name: 'Cleaning', icon: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?q=80&w=2070&auto=format&fit=crop', order: 3, description: 'Professional home and office cleaning' },
    { name: 'AC Repair', icon: 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?q=80&w=2069&auto=format&fit=crop', order: 4, description: 'AC servicing and gas charging' },
    { name: 'Appliances', icon: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?q=80&w=2070&auto=format&fit=crop', order: 5, description: 'Repair for fridge, oven, and washing machines' },
    { name: 'Carpentry', icon: 'https://images.unsplash.com/photo-1505798577917-a65157d3320a?q=80&w=2070&auto=format&fit=crop', order: 6, description: 'Furniture repair and assembly' },
    { name: 'Painting', icon: 'https://images.unsplash.com/photo-1584622781564-1d987f7333c1?q=80&w=2070&auto=format&fit=crop', order: 7, description: 'Full home or room painting' },
    { name: 'Pest Control', icon: 'https://images.unsplash.com/photo-1563453392212-326f5e854473?q=80&w=2070&auto=format&fit=crop', order: 8, description: 'Termite and general pest control' },
    { name: 'Gadgets', icon: 'https://images.unsplash.com/photo-1584438784894-089d6a62b8fa?q=80&w=2070&auto=format&fit=crop', order: 9, description: 'Mobile and laptop repair' }
];

const seedCategories = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        // Clear existing categories
        await Category.deleteMany({});
        console.log('Cleared existing categories');

        // Insert new categories
        await Category.insertMany(categories);
        console.log('Successfully seeded categories');

        process.exit(0);
    } catch (err) {
        console.error('Error seeding categories:', err);
        process.exit(1);
    }
};

seedCategories();
