const express = require('express');
const router = express.Router();
const Trivia = require('../models/Trivia');
const TriviaAttempt = require('../models/TriviaAttempt');
const User = require('../models/User');
const jwt = require('jsonwebtoken');

// Verify token middleware
const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authorization header missing or invalid' });
    }

    const token = authHeader.split(' ')[1];
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
};

// Admin check middleware
const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
    }
    next();
};

// ==========================================
// ADMIN ROUTES
// ==========================================

// GET all trivia questions (Admin)
router.get('/admin', verifyToken, isAdmin, async (req, res) => {
  try {
    const questions = await Trivia.find().sort({ createdAt: -1 });
    res.json(questions);
  } catch (error) {
    console.error('Error fetching trivia:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST new trivia question (Admin)
router.post('/admin', verifyToken, isAdmin, async (req, res) => {
  try {
    const { questionText, options, correctOptionIndex, rewardPoints } = req.body;
    
    if (!questionText || !options || options.length < 2 || correctOptionIndex === undefined) {
      return res.status(400).json({ message: 'Invalid trivia data' });
    }

    const newTrivia = new Trivia({
      questionText,
      options,
      correctOptionIndex,
      rewardPoints: rewardPoints || 10,
      createdBy: req.user._id
    });

    await newTrivia.save();
    res.status(201).json(newTrivia);
  } catch (error) {
    console.error('Error creating trivia:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH toggle active status (Admin)
// To ensure only ONE is active at a time, we'll deactivate all others if setting to true
router.patch('/admin/:id/toggle', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (isActive) {
      // Deactivate all others first
      await Trivia.updateMany({ _id: { $ne: id } }, { isActive: false });
    }

    const updatedTrivia = await Trivia.findByIdAndUpdate(
      id,
      { isActive },
      { new: true }
    );

    if (!updatedTrivia) {
      return res.status(404).json({ message: 'Trivia not found' });
    }

    res.json(updatedTrivia);
  } catch (error) {
    console.error('Error toggling trivia:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE trivia question (Admin)
router.delete('/admin/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    await Trivia.findByIdAndDelete(req.params.id);
    // Optionally delete associated attempts here
    await TriviaAttempt.deleteMany({ triviaId: req.params.id });
    res.json({ message: 'Trivia deleted successfully' });
  } catch (error) {
    console.error('Error deleting trivia:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


// ==========================================
// USER ROUTES
// ==========================================

// GET daily active trivia for the user (Public access to see the question)
router.get('/daily', async (req, res) => {
  try {
    const activeTrivia = await Trivia.findOne({ isActive: true });
    
    if (!activeTrivia) {
      return res.json({ available: false });
    }

    let hasAttempted = false;
    let attemptDetails = null;

    // Optional check if token is provided
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
            const token = authHeader.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            
            // Check if user already attempted it
            const attempt = await TriviaAttempt.findOne({ 
                userId: decoded._id || decoded.id, 
                triviaId: activeTrivia._id 
            });
            
            if (attempt) {
                hasAttempted = true;
                attemptDetails = { isCorrect: attempt.isCorrect, pointsAwarded: attempt.pointsAwarded };
            }
        } catch (e) {}
    }

    res.json({
      available: true,
      hasAttempted,
      attemptDetails,
      trivia: {
        _id: activeTrivia._id,
        questionText: activeTrivia.questionText,
        options: activeTrivia.options,
        rewardPoints: activeTrivia.rewardPoints,
      }
    });

  } catch (error) {
    console.error('Error fetching daily trivia:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST submit trivia answer
router.post('/submit', verifyToken, async (req, res) => {
  try {
    const { triviaId, selectedOptionIndex } = req.body;

    if (!triviaId || selectedOptionIndex === undefined) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // 1. Check if trivia exists and is active
    const trivia = await Trivia.findById(triviaId);
    if (!trivia || !trivia.isActive) {
      return res.status(400).json({ message: 'Trivia not active or not found' });
    }

    // 2. Check if user already attempted
    const existingAttempt = await TriviaAttempt.findOne({ userId: req.user._id, triviaId });
    if (existingAttempt) {
      return res.status(400).json({ message: 'You have already answered this trivia question today!' });
    }

    // 3. Evaluate answer
    const isCorrect = parseInt(selectedOptionIndex) === trivia.correctOptionIndex;
    let pointsAwarded = 0;

    // 4. Award points if correct
    if (isCorrect) {
      pointsAwarded = trivia.rewardPoints;
      await User.findByIdAndUpdate(req.user._id, {
        $inc: { walletBalance: pointsAwarded }
      });
    }

    // 5. Record attempt
    const attempt = new TriviaAttempt({
      userId: req.user._id,
      triviaId: trivia._id,
      isCorrect,
      selectedOptionIndex,
      pointsAwarded
    });
    await attempt.save();

    res.json({
      success: true,
      isCorrect,
      correctOptionIndex: trivia.correctOptionIndex,
      pointsAwarded,
      message: isCorrect ? `Correct! You won ₹${pointsAwarded} wallet points.` : 'Incorrect! Better luck next time.'
    });

  } catch (error) {
    console.error('Error submitting trivia answer:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
