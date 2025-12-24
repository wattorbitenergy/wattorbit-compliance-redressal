const mongoose = require('mongoose');

const CitySchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    state: { type: String, required: true },
    supportContact: { type: String }, // Phone number for city-specific support
    technicianName: { type: String }, // Offline technician name
    technicianPhone: { type: String },
    isOfflineSupportAvailable: { type: Boolean, default: true }
});

module.exports = mongoose.model('City', CitySchema);
