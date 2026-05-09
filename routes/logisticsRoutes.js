const express = require('express');
const router = express.Router();
const LogisticsConfig = require('../models/LogisticsConfig');
const { verifyToken, isAdmin, isAdminOrEngineer } = require('../middleware/authMiddleware');

// GET: All logistics configs
router.get('/configs', verifyToken, isAdminOrEngineer, async (req, res) => {
    try {
        const configs = await LogisticsConfig.find();
        res.json(configs);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching configs', error: err.message });
    }
});

// POST: Save or update logistics config
router.post('/configs', verifyToken, isAdmin, async (req, res) => {
    try {
        const { providerName, isActive } = req.body;
        
        let config = await LogisticsConfig.findOne({ providerName });
        if (config) {
            if (isActive !== undefined) config.isActive = isActive;
        } else {
            // apiKey is now managed via .env, we just store the name and status
            config = new LogisticsConfig({ providerName, apiKey: 'ENV_MANAGED', isActive });
        }
        
        await config.save();
        res.json({ message: 'Configuration saved successfully', config });
    } catch (err) {
        res.status(500).json({ message: 'Error saving config', error: err.message });
    }
});

// PATCH: Toggle config status
router.patch('/configs/:id/toggle', verifyToken, isAdmin, async (req, res) => {
    try {
        const config = await LogisticsConfig.findById(req.params.id);
        if (!config) return res.status(404).json({ message: 'Config not found' });
        
        config.isActive = !config.isActive;
        await config.save();
        
        res.json({ message: `Config ${config.isActive ? 'activated' : 'deactivated'}`, config });
    } catch (err) {
        res.status(500).json({ message: 'Error updating config', error: err.message });
    }
});

module.exports = router;
