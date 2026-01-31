const mongoose = require('mongoose');

const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // e.g. complaintId-2025
  seq: { type: Number, default: 0 }
});

module.exports = mongoose.model('Counter', CounterSchema);
