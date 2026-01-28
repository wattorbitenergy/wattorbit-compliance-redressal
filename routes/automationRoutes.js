const express = require('express');
const router = express.Router();
const AutomationHook = require('../models/AutomationHook');
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

/* =====================
   ADMIN ONLY ENDPOINTS
===================== */

// POST: Create automation hook
router.post('/hooks', verifyToken, isAdmin, async (req, res) => {
    try {
        const {
            name,
            description,
            triggerEvent,
            conditions,
            actions,
            priority
        } = req.body;

        // Validation
        if (!name || !triggerEvent || !actions || actions.length === 0) {
            return res.status(400).json({
                message: 'Missing required fields: name, triggerEvent, actions'
            });
        }

        const hook = new AutomationHook({
            name,
            description,
            triggerEvent,
            conditions: conditions || [],
            actions,
            priority: priority || 0
        });

        await hook.save();

        res.status(201).json({
            message: 'Automation hook created successfully',
            hook
        });
    } catch (err) {
        console.error('Error creating automation hook:', err);
        res.status(500).json({ message: 'Failed to create automation hook' });
    }
});

// GET: List all hooks
router.get('/hooks', verifyToken, isAdmin, async (req, res) => {
    try {
        const { triggerEvent, isActive } = req.query;

        let query = {};

        if (triggerEvent) {
            query.triggerEvent = triggerEvent;
        }

        if (isActive !== undefined) {
            query.isActive = isActive === 'true';
        }

        const hooks = await AutomationHook.find(query)
            .sort({ priority: -1, createdAt: -1 });

        res.json(hooks);
    } catch (err) {
        console.error('Error fetching automation hooks:', err);
        res.status(500).json({ message: 'Failed to fetch automation hooks' });
    }
});

// GET: Get hook details
router.get('/hooks/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const hook = await AutomationHook.findById(req.params.id);

        if (!hook) {
            return res.status(404).json({ message: 'Automation hook not found' });
        }

        res.json(hook);
    } catch (err) {
        console.error('Error fetching automation hook:', err);
        res.status(500).json({ message: 'Failed to fetch automation hook' });
    }
});

// PUT: Update hook
router.put('/hooks/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const {
            name,
            description,
            triggerEvent,
            conditions,
            actions,
            priority
        } = req.body;

        const hook = await AutomationHook.findByIdAndUpdate(
            req.params.id,
            {
                name,
                description,
                triggerEvent,
                conditions,
                actions,
                priority
            },
            { new: true, runValidators: true }
        );

        if (!hook) {
            return res.status(404).json({ message: 'Automation hook not found' });
        }

        res.json({ message: 'Automation hook updated successfully', hook });
    } catch (err) {
        console.error('Error updating automation hook:', err);
        res.status(500).json({ message: 'Failed to update automation hook' });
    }
});

// DELETE: Delete hook
router.delete('/hooks/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const hook = await AutomationHook.findByIdAndDelete(req.params.id);

        if (!hook) {
            return res.status(404).json({ message: 'Automation hook not found' });
        }

        res.json({ message: 'Automation hook deleted successfully' });
    } catch (err) {
        console.error('Error deleting automation hook:', err);
        res.status(500).json({ message: 'Failed to delete automation hook' });
    }
});

// PATCH: Toggle hook active status
router.patch('/hooks/:id/toggle', verifyToken, isAdmin, async (req, res) => {
    try {
        const hook = await AutomationHook.findById(req.params.id);

        if (!hook) {
            return res.status(404).json({ message: 'Automation hook not found' });
        }

        hook.isActive = !hook.isActive;
        await hook.save();

        res.json({
            message: `Automation hook ${hook.isActive ? 'enabled' : 'disabled'} successfully`,
            hook
        });
    } catch (err) {
        console.error('Error toggling automation hook:', err);
        res.status(500).json({ message: 'Failed to toggle automation hook' });
    }
});

// GET: Get execution logs for a hook
router.get('/hooks/:id/logs', verifyToken, isAdmin, async (req, res) => {
    try {
        const hook = await AutomationHook.findById(req.params.id);

        if (!hook) {
            return res.status(404).json({ message: 'Automation hook not found' });
        }

        res.json({
            hookName: hook.name,
            executionCount: hook.executionCount,
            failureCount: hook.failureCount,
            lastExecutedAt: hook.lastExecutedAt,
            logs: hook.executionLogs.slice(-50).reverse() // Last 50 logs, most recent first
        });
    } catch (err) {
        console.error('Error fetching execution logs:', err);
        res.status(500).json({ message: 'Failed to fetch execution logs' });
    }
});

module.exports = router;
