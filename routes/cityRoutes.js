const express = require('express');
const router = express.Router();
const City = require('../models/City');

const defaultCities = [
  { name: 'Lucknow', state: 'Uttar Pradesh' },
  { name: 'Delhi', state: 'Delhi' },
  { name: 'Mumbai', state: 'Maharashtra' },
  { name: 'Bangalore', state: 'Karnataka' },
  { name: 'Hyderabad', state: 'Telangana' },
  { name: 'Ghaziabad', state: 'Uttar Pradesh' },
  { name: 'Bareilly', state: 'Uttar Pradesh' },
  { name: 'Sitapur', state: 'Uttar Pradesh' },
  { name: 'Lakhimpur', state: 'Uttar Pradesh' },
  { name: 'Ayodhya', state: 'Uttar Pradesh' },
  { name: 'Varanasi', state: 'Uttar Pradesh' },
  { name: 'Gonda', state: 'Uttar Pradesh' },
  { name: 'Akbarpur', state: 'Uttar Pradesh' },
  { name: 'Ambedkar Nagar', state: 'Uttar Pradesh' }
];

// GET all cities (LIGHTWEIGHT & FAST)
router.get('/', async (req, res) => {
  try {
    let dbCities = await City.find({})
      .select('name state -_id')
      .lean();

    // Create a Set of normalized names from DB for fast lookup
    const existingNames = new Set(dbCities.map(c => c.name.toLowerCase().trim()));

    // Filter default cities that are NOT in DB
    const missingCities = defaultCities.filter(c => !existingNames.has(c.name.toLowerCase().trim()));

    // Merge and Sort
    const allCities = [...dbCities, ...missingCities].sort((a, b) => a.name.localeCompare(b.name));

    // Optional browser cache (24 hours)
    res.set('Cache-Control', 'public, max-age=86400');
    res.json(allCities);

  } catch (err) {
    console.error('Error fetching cities:', err);
    res.status(500).json({ message: 'Failed to fetch cities' });
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
