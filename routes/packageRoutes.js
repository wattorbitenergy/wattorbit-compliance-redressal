const express = require('express');
const router = express.Router();
const ServicePackage = require('../models/ServicePackage');
const Service = require('../models/Service');
const { generatePackageId } = require('../utils/idGenerator');
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
   PUBLIC ENDPOINTS
===================== */

// GET: Get all packages for a service
router.get('/service/:serviceId', async (req, res) => {
    try {
        const packages = await ServicePackage.find({
            serviceId: req.params.serviceId,
            isActive: true
        })
            .populate('serviceId', 'name category')
            .sort({ price: 1 });

        res.json(packages);
    } catch (err) {
        console.error('Error fetching packages:', err);
        res.status(500).json({ message: 'Failed to fetch packages' });
    }
});

// GET: Get package details
router.get('/:id', async (req, res) => {
    try {
        const package = await ServicePackage.findById(req.params.id)
            .populate('serviceId', 'name category description');

        if (!package) {
            return res.status(404).json({ message: 'Package not found' });
        }

        res.json(package);
    } catch (err) {
        console.error('Error fetching package:', err);
        res.status(500).json({ message: 'Failed to fetch package' });
    }
});

/* =====================
   ADMIN ENDPOINTS
===================== */

// POST: Create package for service (admin only)
router.post('/', verifyToken, isAdmin, async (req, res) => {
    try {
        const {
            serviceId,
            name,
            description,
            price,
            duration,
            features,
            isPopular,
            discount
        } = req.body;

        // Validation
        if (!serviceId || !name || !description || !price || !duration) {
            return res.status(400).json({
                message: 'Missing required fields: serviceId, name, description, price, duration'
            });
        }

        // Verify service exists
        const service = await Service.findById(serviceId);
        if (!service) {
            return res.status(404).json({ message: 'Service not found' });
        }

        const packageId = await generatePackageId();

        const servicePackage = new ServicePackage({
            packageId,
            serviceId,
            name,
            description,
            price,
            duration,
            features: features || [],
            isPopular: isPopular || false,
            discount: discount || { percentage: 0 }
        });

        await servicePackage.save();

        res.status(201).json({
            message: 'Package created successfully',
            package: servicePackage
        });
    } catch (err) {
        console.error('Error creating package:', err);
        res.status(500).json({ message: 'Failed to create package' });
    }
});

// PUT: Update package (admin only)
router.put('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const {
            name,
            description,
            price,
            duration,
            features,
            isPopular,
            discount
        } = req.body;

        const servicePackage = await ServicePackage.findByIdAndUpdate(
            req.params.id,
            {
                name,
                description,
                price,
                duration,
                features,
                isPopular,
                discount
            },
            { new: true, runValidators: true }
        );

        if (!servicePackage) {
            return res.status(404).json({ message: 'Package not found' });
        }

        res.json({
            message: 'Package updated successfully',
            package: servicePackage
        });
    } catch (err) {
        console.error('Error updating package:', err);
        res.status(500).json({ message: 'Failed to update package' });
    }
});

// PATCH: Toggle package active status (admin only)
router.patch('/:id/toggle', verifyToken, isAdmin, async (req, res) => {
    try {
        const servicePackage = await ServicePackage.findById(req.params.id);

        if (!servicePackage) {
            return res.status(404).json({ message: 'Package not found' });
        }

        servicePackage.isActive = !servicePackage.isActive;
        await servicePackage.save();

        res.json({
            message: `Package ${servicePackage.isActive ? 'activated' : 'deactivated'} successfully`,
            package: servicePackage
        });
    } catch (err) {
        console.error('Error toggling package status:', err);
        res.status(500).json({ message: 'Failed to toggle package status' });
    }
});

// DELETE: Delete package (admin only)
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const servicePackage = await ServicePackage.findByIdAndDelete(req.params.id);

        if (!servicePackage) {
            return res.status(404).json({ message: 'Package not found' });
        }

        res.json({ message: 'Package deleted successfully' });
    } catch (err) {
        console.error('Error deleting package:', err);
        res.status(500).json({ message: 'Failed to delete package' });
    }
});

// GET: Get all packages including inactive (admin only)
router.get('/admin/all', verifyToken, isAdmin, async (req, res) => {
    try {
        const packages = await ServicePackage.find()
            .populate('serviceId', 'name category')
            .sort({ createdAt: -1 });

        res.json(packages);
    } catch (err) {
        console.error('Error fetching all packages:', err);
        res.status(500).json({ message: 'Failed to fetch packages' });
    }
});

module.exports = router;
