const mongoose = require("mongoose");

const triviaAttemptSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  triviaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Trivia",
    required: true,
  },
  isCorrect: {
    type: Boolean,
    required: true,
  },
  selectedOptionIndex: {
    type: Number,
    required: true,
  },
  pointsAwarded: {
    type: Number,
    default: 0,
  }
}, { timestamps: true });

// Ensure a user can only attempt a specific trivia question once
triviaAttemptSchema.index({ userId: 1, triviaId: 1 }, { unique: true });

module.exports = mongoose.model("TriviaAttempt", triviaAttemptSchema);
