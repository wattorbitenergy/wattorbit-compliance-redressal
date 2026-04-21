const express = require('express');
const router = express.Router();
const ReferralRule = require('../models/ReferralRule');
const jwt = require('jsonwebtoken');

const { verifyToken, isAdmin } = require('../middleware/authMiddleware');

// Get all rules
router.get('/', verifyToken, isAdmin, async (req, res) => {
    try {
        const rules = await ReferralRule.find().sort({ targetRole: 1 });
        res.json(rules);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Create/Update rule
router.post('/', verifyToken, isAdmin, async (req, res) => {
    const { targetRole, targetSpecialization, referrerReward, refereeReward, isActive, description } = req.body;
    try {
        // Upsert logic: unique per role + specialization
        let rule = await ReferralRule.findOne({ targetRole, targetSpecialization });
        if (rule) {
            rule.referrerReward = referrerReward;
            rule.refereeReward = refereeReward;
            rule.isActive = isActive;
            rule.description = description;
            await rule.save();
        } else {
            rule = new ReferralRule({ targetRole, targetSpecialization, referrerReward, refereeReward, isActive, description });
            await rule.save();
        }
        res.json(rule);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Delete rule
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        await ReferralRule.findByIdAndDelete(req.params.id);
        res.json({ message: 'Rule deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
