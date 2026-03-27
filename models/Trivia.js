const mongoose = require("mongoose");

const triviaSchema = new mongoose.Schema({
  questionText: {
    type: String,
    required: true,
    trim: true,
  },
  options: [{
    type: String,
    required: true,
  }],
  correctOptionIndex: {
    type: Number,
    required: true,
    min: 0,
  },
  rewardPoints: {
    type: Number,
    required: true,
    default: 10,
  },
  isActive: {
    type: Boolean,
    default: false,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "admin",
    required: false, // Make optional if seeded
  }
}, { timestamps: true });

module.exports = mongoose.model("Trivia", triviaSchema);
