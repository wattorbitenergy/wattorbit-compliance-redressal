const express = require('express');
const router = express.Router();
const City = require('../models/City');

// GET all cities
router.get('/', async (req, res) => {
    try {
        let cities = await City.find();

        // Fallback if no cities in database
        if (cities.length === 0) {
            cities = [
                { _id: 'fallback-1', name: 'Lucknow', state: 'Uttar Pradesh' },
                { _id: 'fallback-2', name: 'Delhi', state: 'Delhi' },
                { _id: 'fallback-3', name: 'Mumbai', state: 'Maharashtra' },
                { _id: 'fallback-4', name: 'Bangalore', state: 'Karnataka' },
                { _id: 'fallback-5', name: 'Hyderabad', state: 'Telangana' },
                { _id: 'fallback-6', name: 'Ghaziabad', state: 'Uttar Pradesh' },
                { _id: 'fallback-7', name: 'Bareilly', state: 'Uttar Pradesh' },
                { _id: 'fallback-8', name: 'Sitapur', state: 'Uttar Pradesh' },
                { _id: 'fallback-9', name: 'Lakhimpur', state: 'Uttar Pradesh' },
                { _id: 'fallback-10', name: 'Ayodhya', state: 'Uttar Pradesh' },
                { _id: 'fallback-11', name: 'Varanasi', state: 'Uttar Pradesh' },
                { _id: 'fallback-12', name: 'Gonda', state: 'Uttar Pradesh' },
                { _id: 'fallback-13', name: 'Akbarpur', state: 'Uttar Pradesh' },
                { _id: 'fallback-14', name: 'Ambedkar Nagar', state: 'Uttar Pradesh' }
            ];
        }

        res.json(cities);
    } catch (err) {
        console.error('Error fetching cities:', err);
        res.status(500).json({ message: err.message });
    }
});

// POST new city (for admin use mainly, but exposed for demo)
router.post('/', async (req, res) => {
    const city = new City({
        name: req.body.name,
        state: req.body.state,
        supportContact: req.body.supportContact,
        technicianName: req.body.technicianName,
        technicianPhone: req.body.technicianPhone,
        isOfflineSupportAvailable: req.body.isOfflineSupportAvailable
    });

    try {
        const newCity = await city.save();
        res.status(201).json(newCity);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

module.exports = router;
