const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const Category = require('../models/Category');

const categories = [
    { name: 'Electrical', icon: 'Zap', order: 1, description: 'All electrical repairs and installations' },
    { name: 'Plumbing', icon: 'Droplets', order: 2, description: 'Fix leaks, pipes, and bathroom fittings' },
    { name: 'Cleaning', icon: 'Sparkles', order: 3, description: 'Professional home and office cleaning' },
    { name: 'AC Repair', icon: 'Wind', order: 4, description: 'AC servicing and gas charging' },
    { name: 'Appliances', icon: 'Speaker', order: 5, description: 'Repair for fridge, oven, and washing machines' },
    { name: 'Carpentry', icon: 'Hammer', order: 6, description: 'Furniture repair and assembly' },
    { name: 'Painting', icon: 'Palette', order: 7, description: 'Full home or room painting' },
    { name: 'Pest Control', icon: 'ShieldAlert', order: 8, description: 'Termite and general pest control' },
    { name: 'Gadgets', icon: 'Smartphone', order: 9, description: 'Mobile and laptop repair' }
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
