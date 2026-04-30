const express = require('express');
const router = express.Router();
const Material = require('../models/Material');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { uploadToCloudinary } = require('../utils/cloudinaryHelper');

const { verifyToken } = require('../middleware/authMiddleware');

// Admin/Employee check
const canManageInventory = (req, res, next) => {
    const allowedRoles = ['admin', 'employee', 'engineer'];
    if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ message: 'Access denied: Requires Admin, Employee, or Engineer role' });
    }
    next();
};

// Multer config for material images
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dest = path.join(__dirname, '../uploads/materials');
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        cb(null, dest);
    },
    filename: (req, file, cb) => cb(null, `material_${Date.now()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 } }); // 2MB max

// GET: List all materials (Public access)
router.get('/', async (req, res) => {
    try {
        let selectFields = 'name make description materialCode unit sellingPrice sellingTaxRate sellingTaxAmount images mrp isActive stockQuantity averageRating numReviews';
        
        // If logged in, we might provide more info
        const authHeader = req.headers.authorization;
        if (authHeader) {
            try {
                const token = authHeader.split(' ')[1];
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                if (['admin', 'employee', 'technician'].includes(decoded.role)) {
                    selectFields = 'name make description hsnCode materialCode unit sellingPrice sellingTaxRate sellingTaxAmount stockQuantity images mrp isActive averageRating numReviews';
                }
            } catch (e) {}
        }

        const materials = await Material.find({ isActive: true }).select(selectFields).sort({ name: 1 });
        res.json(materials);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching materials', error: err.message });
    }
});

// GET: Low stock alerts (Admin/Employee only)
router.get('/alerts/low-stock', verifyToken, canManageInventory, async (req, res) => {
    try {
        const materials = await Material.find({ isActive: true });
        const lowStock = materials.filter(m => m.stockQuantity <= m.reorderLevel);
        res.json({
            count: lowStock.length,
            materials: lowStock.map(m => ({
                _id: m._id,
                name: m.name,
                make: m.make,
                stockQuantity: m.stockQuantity,
                reorderLevel: m.reorderLevel
            }))
        });
    } catch (err) {
        res.status(500).json({ message: 'Error checking stock alerts', error: err.message });
    }
});

// GET: Material usage report (Admin/Employee only)
router.get('/reports/usage', verifyToken, canManageInventory, async (req, res) => {
    try {
        const Booking = require('../models/Booking');
        const { startDate, endDate } = req.query;
        
        let dateFilter = {};
        if (startDate && endDate) {
            dateFilter = { createdAt: { $gte: new Date(startDate), $lte: new Date(endDate + 'T23:59:59Z') } };
        }

        // Get all bookings with materials
        const bookings = await Booking.find({
            ...dateFilter,
            'materialsUsed.0': { $exists: true }
        }).select('materialsUsed materialTotal materialTaxTotal createdAt');

        // Aggregate usage stats per material
        const usageMap = {};
        let totalRevenue = 0;
        let totalTax = 0;
        let totalInputTax = 0;
        let totalUnits = 0;

        bookings.forEach(b => {
            b.materialsUsed.forEach(m => {
                const key = m.materialId?.toString() || m.name;
                if (!usageMap[key]) {
                    usageMap[key] = {
                        name: m.name,
                        make: m.make,
                        totalQuantity: 0,
                        totalRevenue: 0,
                        totalTax: 0,
                        totalInputTax: 0,
                        usageCount: 0
                    };
                }
                usageMap[key].totalQuantity += m.quantity;
                usageMap[key].totalRevenue += m.sellingPrice * m.quantity;
                usageMap[key].totalTax += m.sellingTaxAmount * m.quantity;
                usageMap[key].totalInputTax += (m.purchaseTaxAmount || 0) * m.quantity;
                usageMap[key].usageCount += 1;
                totalRevenue += m.sellingPrice * m.quantity;
                totalTax += m.sellingTaxAmount * m.quantity;
                totalInputTax += (m.purchaseTaxAmount || 0) * m.quantity;
                totalUnits += m.quantity;
            });
        });

        const usageList = Object.values(usageMap).sort((a, b) => b.totalQuantity - a.totalQuantity);

        res.json({
            summary: {
                totalBookingsWithMaterials: bookings.length,
                totalUnitsUsed: totalUnits,
                totalMaterialRevenue: totalRevenue,
                totalMaterialOutputTax: totalTax,
                totalMaterialInputTax: totalInputTax,
                netMaterialLiability: totalTax - totalInputTax
            },
            materials: usageList
        });
    } catch (err) {
        res.status(500).json({ message: 'Error generating usage report', error: err.message });
    }
});

// GET: Single material (Public access)
router.get('/:id', async (req, res) => {
    try {
        let selectFields = 'name make description materialCode unit sellingPrice sellingTaxRate sellingTaxAmount images mrp isActive stockQuantity averageRating numReviews';

        const authHeader = req.headers.authorization;
        if (authHeader) {
            try {
                const token = authHeader.split(' ')[1];
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                if (['admin', 'employee', 'technician'].includes(decoded.role)) {
                    selectFields = 'name make description hsnCode materialCode unit sellingPrice sellingTaxRate sellingTaxAmount stockQuantity images mrp isActive averageRating numReviews';
                }
            } catch (e) {}
        }
        
        const material = await Material.findById(req.params.id).select(selectFields);
        if (!material) return res.status(404).json({ message: 'Material not found' });
        res.json(material);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching material', error: err.message });
    }
});

// POST: Create material (Admin/Employee only)
router.post('/', verifyToken, canManageInventory, async (req, res) => {
    try {
        const material = new Material(req.body);
        await material.save();
        res.status(201).json(material);
    } catch (err) {
        res.status(400).json({ message: 'Error creating material', error: err.message });
    }
});

// POST: Bulk CSV Import (Admin/Employee only)
router.post('/bulk-import', verifyToken, canManageInventory, async (req, res) => {
    try {
        const { materials } = req.body;
        if (!Array.isArray(materials) || materials.length === 0) {
            return res.status(400).json({ message: 'materials array is required' });
        }

        const results = { created: 0, errors: [] };

        for (let i = 0; i < materials.length; i++) {
            try {
                const item = materials[i];
                // Validate required fields
                if (!item.name || !item.make || !item.description || 
                    item.purchasePrice === undefined || item.purchaseTaxRate === undefined ||
                    item.sellingPrice === undefined || item.sellingTaxRate === undefined) {
                    results.errors.push({ row: i + 1, error: 'Missing required fields' });
                    continue;
                }

                // Remove batchNumber if it exists in imported data (since it's removed from model)
                if (item.batchNumber) delete item.batchNumber;

                const mat = new Material(item);
                await mat.save();
                results.created++;
            } catch (err) {
                results.errors.push({ row: i + 1, error: err.message });
            }
        }

        res.json({
            message: `Imported ${results.created} of ${materials.length} materials`,
            ...results
        });
    } catch (err) {
        res.status(500).json({ message: 'Bulk import failed', error: err.message });
    }
});

// POST: Upload material image (Cloudinary)
router.post('/:id/upload-image', verifyToken, canManageInventory, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'No image file provided' });

        const material = await Material.findById(req.params.id);
        if (!material) {
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(404).json({ message: 'Material not found' });
        }

        if (material.images && material.images.length >= 4) {
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(400).json({ message: 'Maximum 4 photos allowed per material' });
        }

        // Upload to Cloudinary
        const cloudinaryResult = await uploadToCloudinary(req.file.path, 'wattorbit/materials');
        
        // Push to images array
        if (!material.images) material.images = [];
        material.images.push(cloudinaryResult.url);
        await material.save();

        // Clean up temp file
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        res.json({ message: 'Image uploaded to Cloudinary', images: material.images, material });
    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ message: 'Error uploading image to Cloudinary', error: err.message });
    }
});

// --- REVIEWS ---
const MaterialReview = require('../models/MaterialReview');

// POST: Add a review
router.post('/:id/reviews', verifyToken, async (req, res) => {
    try {
        const { rating, comment, images } = req.body;
        const materialId = req.params.id;
        const userId = req.user.id || req.user._id;
        const userName = req.user.name || req.user.username;

        // Check if user already reviewed
        const existing = await MaterialReview.findOne({ materialId, userId });
        if (existing) return res.status(400).json({ message: 'You have already reviewed this material' });

        const review = new MaterialReview({
            materialId,
            userId,
            userName,
            rating,
            comment,
            images: images || []
        });

        await review.save();
        res.status(201).json(review);
    } catch (err) {
        res.status(400).json({ message: 'Error adding review', error: err.message });
    }
});

// GET: Get reviews for a material
router.get('/:id/reviews', async (req, res) => {
    try {
        const reviews = await MaterialReview.find({ materialId: req.params.id }).sort({ createdAt: -1 });
        res.json(reviews);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching reviews', error: err.message });
    }
});

// PUT: Update material (Admin/Employee only)
router.put('/:id', verifyToken, canManageInventory, async (req, res) => {
    try {
        const material = await Material.findById(req.params.id);
        if (!material) return res.status(404).json({ message: 'Material not found' });
        
        // Update fields
        Object.assign(material, req.body);
        await material.save(); // triggers pre-save hooks for tax calc
        
        res.json(material);
    } catch (err) {
        res.status(400).json({ message: 'Error updating material', error: err.message });
    }
});

// DELETE: Deactivate material (Admin/Employee only)
router.delete('/:id', verifyToken, canManageInventory, async (req, res) => {
    try {
        const { remark } = req.body;
        const material = await Material.findByIdAndUpdate(
            req.params.id, 
            { 
                isActive: false, 
                deactivationRemark: remark || 'No reason provided',
                deactivatedAt: new Date()
            }, 
            { new: true }
        );
        if (!material) return res.status(404).json({ message: 'Material not found' });
        res.json({ message: 'Material deactivated successfully', material });
    } catch (err) {
        res.status(500).json({ message: 'Error deactivating material', error: err.message });
    }
});

module.exports = router;
