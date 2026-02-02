const express = require('express');
const router = express.Router();
const Service = require('../models/Service');
const ServicePackage = require('../models/ServicePackage');
const { generateServiceId } = require('../utils/idGenerator');
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

// GET: List all active services with filters
router.get('/', async (req, res) => {
    try {
        const { category, city, search, subcategory } = req.query;

        let query = { isActive: true };

        if (category) {
            query.category = category;
        }

        if (subcategory) {
            query.subcategory = subcategory;
        }

        if (city) {
            query.availableCities = city;
        }

        if (search) {
            query.$text = { $search: search };
        }

        const services = await Service.find(query)
            .populate('createdBy', 'name username')
            .sort({ createdAt: -1 });

        res.json(services);
    } catch (err) {
        console.error('Error fetching services:', err);
        res.status(500).json({ message: 'Failed to fetch services' });
    }
});

// GET: Get service details with packages
router.get('/:id', async (req, res) => {
    try {
        const service = await Service.findById(req.params.id)
            .populate('createdBy', 'name username');

        if (!service) {
            return res.status(404).json({ message: 'Service not found' });
        }

        // Get associated packages
        const packages = await ServicePackage.find({
            serviceId: service._id,
            isActive: true
        }).sort({ price: 1 });

        res.json({ service, packages });
    } catch (err) {
        console.error('Error fetching service details:', err);
        res.status(500).json({ message: 'Failed to fetch service details' });
    }
});

// GET: Get all categories (from schema enum and active services)
router.get('/meta/categories', async (req, res) => {
    try {
        const schemaCategories = Service.schema.path('category').enumValues;
        const activeCategories = await Service.distinct('category', { isActive: true });

        // Combine and remove duplicates
        const allCategories = [...new Set([...schemaCategories, ...activeCategories])];
        res.json(allCategories);
    } catch (err) {
        console.error('Error fetching categories:', err);
        res.status(500).json({ message: 'Failed to fetch categories' });
    }
});

/* =====================
   ADMIN ENDPOINTS
===================== */

// POST: Create new service (admin only)
router.post('/', verifyToken, isAdmin, async (req, res) => {
    try {
        const {
            name,
            description,
            category,
            subcategory,
            images,
            basePrice,
            duration,
            tags,
            availableCities,
            metadata
        } = req.body;

        // Validation
        if (!name || !description || !category || !basePrice || !duration) {
            return res.status(400).json({
                message: 'Missing required fields: name, description, category, basePrice, duration'
            });
        }

        const serviceId = await generateServiceId();

        const service = new Service({
            serviceId,
            name,
            description,
            category,
            subcategory,
            images: images || [],
            basePrice,
            duration,
            tags: tags || [],
            availableCities: availableCities || [],
            createdBy: req.user.id,
            metadata: metadata || {}
        });

        await service.save();

        res.status(201).json({
            message: 'Service created successfully',
            service
        });
    } catch (err) {
        console.error('Error creating service:', err);
        res.status(500).json({ message: 'Failed to create service' });
    }
});

// PUT: Update service (admin only)
router.put('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const {
            name,
            description,
            category,
            subcategory,
            images,
            basePrice,
            duration,
            tags,
            availableCities,
            metadata
        } = req.body;

        const service = await Service.findByIdAndUpdate(
            req.params.id,
            {
                name,
                description,
                category,
                subcategory,
                images,
                basePrice,
                duration,
                tags,
                availableCities,
                metadata
            },
            { new: true, runValidators: true }
        );

        if (!service) {
            return res.status(404).json({ message: 'Service not found' });
        }

        res.json({ message: 'Service updated successfully', service });
    } catch (err) {
        console.error('Error updating service:', err);
        res.status(500).json({ message: 'Failed to update service' });
    }
});

// PATCH: Toggle service active status (admin only)
router.patch('/:id/toggle', verifyToken, isAdmin, async (req, res) => {
    try {
        const service = await Service.findById(req.params.id);

        if (!service) {
            return res.status(404).json({ message: 'Service not found' });
        }

        service.isActive = !service.isActive;
        await service.save();

        res.json({
            message: `Service ${service.isActive ? 'activated' : 'deactivated'} successfully`,
            service
        });
    } catch (err) {
        console.error('Error toggling service status:', err);
        res.status(500).json({ message: 'Failed to toggle service status' });
    }
});

// DELETE: Delete service (admin only)
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        // Check if service has associated packages
        const packagesCount = await ServicePackage.countDocuments({
            serviceId: req.params.id
        });

        if (packagesCount > 0) {
            return res.status(400).json({
                message: 'Cannot delete service with associated packages. Delete packages first.'
            });
        }

        const service = await Service.findByIdAndDelete(req.params.id);

        if (!service) {
            return res.status(404).json({ message: 'Service not found' });
        }

        res.json({ message: 'Service deleted successfully' });
    } catch (err) {
        console.error('Error deleting service:', err);
        res.status(500).json({ message: 'Failed to delete service' });
    }
});

// GET: Get all services including inactive (admin only)
router.get('/admin/all', verifyToken, isAdmin, async (req, res) => {
    try {
        const services = await Service.find()
            .populate('createdBy', 'name username')
            .sort({ createdAt: -1 });

        res.json(services);
    } catch (err) {
        console.error('Error fetching all services:', err);
        res.status(500).json({ message: 'Failed to fetch services' });
    }
});

module.exports = router;
