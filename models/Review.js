const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  customerName: {
    type: String,
    required: true,
    trim: true
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  reviewText: {
    type: String,
    required: true,
    trim: true
  },
  serviceCategory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category', // Optional reference to tie a review directly to AC Repair or Plumbing
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  source: {
    type: String,
    default: 'Google' // e.g., 'Google', 'App', 'Website'
  }
}, { timestamps: true });

module.exports = mongoose.model('Review', reviewSchema);
