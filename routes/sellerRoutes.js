const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Material = require('../models/Material');
const Order = require('../models/Order');
const SellerSettlement = require('../models/SellerSettlement');
const { round } = require('../utils/mathUtils');
const { verifyGSTINWithGovt } = require('../utils/govtVerificationGateway');
const { verifyToken } = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { uploadToCloudinary } = require('../utils/cloudinaryHelper');

// Middleware to ensure user is an authenticated seller
const requireSeller = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id || req.user._id);
        if (!user || user.role !== 'seller') {
            return res.status(403).json({ success: false, message: 'Access denied: Requires registered Seller account' });
        }
        req.seller = user;
        next();
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Server error verifying seller role' });
    }
};

// Admin middleware
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Access denied: Requires Admin role' });
    }
    next();
};

// Multer config for seller product images
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dest = path.join(__dirname, '../uploads/seller-products');
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        cb(null, dest);
    },
    filename: (req, file, cb) => cb(null, `prod_${Date.now()}_${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 3 * 1024 * 1024 } }); // 3MB limit

/* ========================================================
   1. SELLER ONBOARDING & PROFILE MANAGEMENT
======================================================== */

// POST /api/sellers/register - Upgrade an existing user or onboard as a seller

// POST /api/sellers/verify-gstin - Automated Government GSTIN & Business Entity Verification
router.post('/verify-gstin', verifyToken, async (req, res) => {
    try {
        const { gstin } = req.body;
        if (!gstin) {
            return res.status(400).json({ success: false, message: 'GSTIN is required' });
        }

        const result = await verifyGSTINWithGovt(gstin);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                verified: false,
                message: result.message || 'GSTIN verification failed'
            });
        }

        res.status(200).json({
            success: true,
            verified: true,
            source: result.source,
            business: result.data
        });
    } catch (err) {
        console.error('[GSTIN Verification Error]:', err);
        res.status(500).json({ success: false, message: 'Server error during GST verification' });
    }
});

router.post('/register', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id || req.user._id;
        const {
            storeName,
            businessType,
            gstin,
            pan,
            pickupAddress,
            bankDetails
        } = req.body;

        if (!storeName || !gstin || !pan) {
            return res.status(400).json({
                success: false,
                message: 'Store Name, GSTIN, and PAN are mandatory for seller registration'
            });
        }

        // Validate basic GSTIN format (15 characters: 2 state + 10 PAN + 1 entity + 1 Z + 1 check)
        const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
        if (!gstinRegex.test(gstin.trim().toUpperCase())) {
            return res.status(400).json({
                success: false,
                message: 'Invalid GSTIN format. Expected 15-character alphanumeric GSTIN.'
            });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        user.role = 'seller';
        user.sellerProfile = {
            storeName: storeName.trim(),
            businessType: businessType || 'Proprietorship',
            gstin: gstin.trim().toUpperCase(),
            pan: pan.trim().toUpperCase(),
            pickupAddress: pickupAddress || {},
            bankDetails: bankDetails || {},
            commissionRate: 10,
            kycStatus: 'submitted',
            isActiveSeller: true // Set active or pending based on admin policy
        };

        await user.save();

        res.status(200).json({
            success: true,
            message: 'Seller account registered successfully',
            sellerProfile: user.sellerProfile
        });
    } catch (err) {
        console.error('[Seller Register Error]:', err);
        res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
});

// GET /api/sellers/profile - Get current seller profile & status
router.get('/profile', verifyToken, requireSeller, async (req, res) => {
    try {
        res.status(200).json({
            success: true,
            seller: {
                id: req.seller._id,
                name: req.seller.name,
                email: req.seller.email,
                phone: req.seller.phone,
                sellerProfile: req.seller.sellerProfile
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch seller profile' });
    }
});

// PUT /api/sellers/profile - Update seller profile / pickup address / bank
router.put('/profile', verifyToken, requireSeller, async (req, res) => {
    try {
        const { storeName, pickupAddress, bankDetails } = req.body;
        const seller = req.seller;

        if (storeName) seller.sellerProfile.storeName = storeName.trim();
        if (pickupAddress) seller.sellerProfile.pickupAddress = pickupAddress;
        if (bankDetails) seller.sellerProfile.bankDetails = bankDetails;

        await seller.save();
        res.status(200).json({ success: true, message: 'Seller profile updated', sellerProfile: seller.sellerProfile });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to update seller profile' });
    }
});

/* ========================================================
   2. SELLER PRODUCT LISTING & INVENTORY MANAGEMENT
======================================================== */

// GET /api/sellers/products - View listings belonging to the seller
router.get('/products', verifyToken, requireSeller, async (req, res) => {
    try {
        const products = await Material.find({ sellerId: req.seller._id }).sort({ createdAt: -1 });
        res.status(200).json({ success: true, count: products.length, products });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to retrieve products' });
    }
});

// POST /api/sellers/products - Create a new product listing (Self-serve)
router.post('/products', verifyToken, requireSeller, upload.array('images', 5), async (req, res) => {
    try {
        const {
            name,
            make,
            description,
            hsnCode,
            unit,
            stockQuantity,
            reorderLevel,
            warrantyMonths,
            mrp,
            sellingPrice,
            sellingTaxRate,
            specifications
        } = req.body;

        if (!name || !make || !sellingPrice || !mrp) {
            return res.status(400).json({ success: false, message: 'Product name, make/brand, MRP, and selling price are required.' });
        }

        // Upload images to Cloudinary if configured, else fallback to local file paths
        let imageUrls = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                try {
                    const cRes = await uploadToCloudinary(file.path, 'seller_materials');
                    if (cRes && cRes.secure_url) {
                        imageUrls.push(cRes.secure_url);
                    } else {
                        imageUrls.push(`/uploads/seller-products/${file.filename}`);
                    }
                } catch {
                    imageUrls.push(`/uploads/seller-products/${file.filename}`);
                }
            }
        }

        let parsedSpecs = [];
        if (specifications) {
            try {
                parsedSpecs = typeof specifications === 'string' ? JSON.parse(specifications) : specifications;
            } catch (e) {
                parsedSpecs = [];
            }
        }

        const newListing = new Material({
            name: name.trim(),
            make: make.trim(),
            description: description ? description.trim() : name.trim(),
            hsnCode: hsnCode ? hsnCode.trim() : '8536',
            unit: unit || 'pcs',
            stockQuantity: Number(stockQuantity || 0),
            reorderLevel: Number(reorderLevel || 5),
            warrantyMonths: Number(warrantyMonths || 0),
            images: imageUrls,
            // For seller-owned products, purchasePrice matches their base expectation or zero
            purchasePrice: Number(sellingPrice),
            purchaseTaxRate: Number(sellingTaxRate || 18),
            mrp: Number(mrp),
            sellingPrice: Number(sellingPrice),
            sellingTaxRate: Number(sellingTaxRate || 18),
            sellerId: req.seller._id,
            listingType: 'seller',
            approvalStatus: 'approved', // Live immediately or pending based on marketplace policy
            isActive: true,
            specifications: parsedSpecs
        });

        await newListing.save();

        res.status(201).json({
            success: true,
            message: 'Product listed successfully',
            product: newListing
        });
    } catch (err) {
        console.error('[Seller Product Create Error]:', err);
        res.status(500).json({ success: false, message: 'Failed to create product listing', error: err.message });
    }
});

// PATCH /api/sellers/products/:id/stock - Quick inventory & price update
router.patch('/products/:id/stock', verifyToken, requireSeller, async (req, res) => {
    try {
        const { stockQuantity, sellingPrice, mrp, isActive } = req.body;
        const product = await Material.findOne({ _id: req.params.id, sellerId: req.seller._id });

        if (!product) {
            return res.status(404).json({ success: false, message: 'Product listing not found for this seller' });
        }

        if (stockQuantity !== undefined) product.stockQuantity = Math.max(0, Number(stockQuantity));
        if (sellingPrice !== undefined) product.sellingPrice = Math.max(0, Number(sellingPrice));
        if (mrp !== undefined) product.mrp = Math.max(0, Number(mrp));
        if (isActive !== undefined) product.isActive = Boolean(isActive);

        await product.save();

        res.status(200).json({
            success: true,
            message: 'Stock and pricing updated',
            product
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to update stock' });
    }
});

/* ========================================================
   3. SELLER ORDER MANAGEMENT & FULFILLMENT
======================================================== */

// GET /api/sellers/orders - View customer orders containing products from this seller
router.get('/orders', verifyToken, requireSeller, async (req, res) => {
    try {
        // Find all material IDs owned by this seller
        const sellerMaterials = await Material.find({ sellerId: req.seller._id }).select('_id');
        const materialIds = sellerMaterials.map(m => m._id);

        const orders = await Order.find({ 'items.materialId': { $in: materialIds } })
            .populate('userId', 'name phone email')
            .populate('addressId')
            .sort({ createdAt: -1 });

        // Filter and present line items relevant to this seller
        const sellerOrders = orders.map(order => {
            const sellerItems = order.items.filter(item => materialIds.some(id => id.equals(item.materialId)));
            const sellerSubtotal = sellerItems.reduce((acc, item) => acc + (item.totalLineAmount || 0), 0);
            return {
                orderId: order.orderId,
                orderDate: order.createdAt,
                status: order.status || order.paymentStatus,
                customer: order.userId,
                shippingAddress: order.addressId,
                items: sellerItems,
                sellerTotal: sellerSubtotal,
                paymentMethod: order.paymentMethod,
                paymentStatus: order.paymentStatus
            };
        });

        res.status(200).json({ success: true, count: sellerOrders.length, orders: sellerOrders });
    } catch (err) {
        console.error('[Seller Orders Error]:', err);
        res.status(500).json({ success: false, message: 'Failed to retrieve orders' });
    }
});

/* ========================================================
   4. ADMIN SELLER GOVERNANCE & APPROVAL
======================================================== */

// GET /api/sellers/admin/settlements/all - Admin view of all seller settlements
router.get('/admin/settlements/all', verifyToken, requireAdmin, async (req, res) => {
    try {
        const settlements = await SellerSettlement.find({})
            .populate('sellerId', 'name email phone sellerProfile')
            .sort({ createdAt: -1 });

        let totalGross = 0;
        let totalCommission = 0;
        let totalTCS = 0;
        let totalPayoutsReady = 0;
        let totalSettled = 0;

        settlements.forEach(s => {
            totalGross += s.grossSaleAmount || 0;
            totalCommission += (s.commissionAmount + s.commissionGSTAmount) || 0;
            totalTCS += s.tcsAmount || 0;
            if (s.status === 'ready_for_payout') totalPayoutsReady += s.netPayoutAmount || 0;
            if (s.status === 'settled') totalSettled += s.netPayoutAmount || 0;
        });

        res.status(200).json({
            success: true,
            summary: {
                totalGross: round(totalGross),
                totalCommission: round(totalCommission),
                totalTCS: round(totalTCS),
                totalPayoutsReady: round(totalPayoutsReady),
                totalSettled: round(totalSettled),
                count: settlements.length
            },
            settlements
        });
    } catch (err) {
        console.error('[Admin Settlements Error]:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch settlements' });
    }
});

// GET /api/sellers/admin/all - Admin view of all onboarded sellers
router.get('/admin/all', verifyToken, requireAdmin, async (req, res) => {
    try {
        const sellers = await User.find({ role: 'seller' })
            .select('name email phone sellerProfile createdAt isApproved')
            .sort({ createdAt: -1 });
        res.status(200).json({ success: true, count: sellers.length, sellers });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch sellers list' });
    }
});

// PATCH /api/sellers/admin/:id/kyc - Approve or reject seller KYC
router.patch('/admin/:id/kyc', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { kycStatus, rejectionReason, commissionRate } = req.body;
        const seller = await User.findOne({ _id: req.params.id, role: 'seller' });

        if (!seller) {
            return res.status(404).json({ success: false, message: 'Seller not found' });
        }

        if (kycStatus) seller.sellerProfile.kycStatus = kycStatus;
        if (rejectionReason !== undefined) seller.sellerProfile.kycRejectionReason = rejectionReason;
        if (commissionRate !== undefined) seller.sellerProfile.commissionRate = Number(commissionRate);
        seller.sellerProfile.isActiveSeller = kycStatus === 'verified';

        await seller.save();
        res.status(200).json({ success: true, message: `Seller KYC updated to ${kycStatus}`, sellerProfile: seller.sellerProfile });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to update seller KYC' });
    }
});


/* ========================================================
   5. SELLER SETTLEMENTS & PAYOUT LEDGER
======================================================== */

// GET /api/sellers/settlements - Seller view of their financial ledger & settlements
router.get('/settlements', verifyToken, requireSeller, async (req, res) => {
    try {
        const settlements = await SellerSettlement.find({ sellerId: req.seller._id })
            .sort({ createdAt: -1 });

        // Calculate cumulative metrics
        let totalGrossSales = 0;
        let totalCommissionsPaid = 0;
        let totalTCSDeducted = 0;
        let totalSettled = 0;
        let pendingPayout = 0;

        settlements.forEach(s => {
            totalGrossSales += s.grossSaleAmount || 0;
            totalCommissionsPaid += (s.commissionAmount + s.commissionGSTAmount) || 0;
            totalTCSDeducted += s.tcsAmount || 0;

            if (s.status === 'settled') {
                totalSettled += s.netPayoutAmount || 0;
            } else if (['escrow_hold', 'ready_for_payout'].includes(s.status)) {
                pendingPayout += s.netPayoutAmount || 0;
            }
        });

        res.status(200).json({
            success: true,
            summary: {
                totalGrossSales: round(totalGrossSales),
                totalCommissionsPaid: round(totalCommissionsPaid),
                totalTCSDeducted: round(totalTCSDeducted),
                totalSettled: round(totalSettled),
                pendingPayout: round(pendingPayout),
                totalSettlementCount: settlements.length
            },
            settlements
        });
    } catch (err) {
        console.error('[Seller Settlements Error]:', err);
        res.status(500).json({ success: false, message: 'Failed to retrieve settlements' });
    }
});

// POST /api/sellers/orders/:orderId/generate-settlement - Automatic calculation of seller settlement
router.post('/orders/:orderId/generate-settlement', verifyToken, async (req, res) => {
    try {
        const order = await Order.findById(req.params.orderId).populate('items.materialId');
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        // Group items by seller
        const sellerItemsMap = {};
        for (const item of order.items) {
            const mat = item.materialId;
            if (mat && mat.sellerId) {
                const sId = String(mat.sellerId);
                if (!sellerItemsMap[sId]) sellerItemsMap[sId] = [];
                sellerItemsMap[sId].push(item);
            }
        }

        const generatedSettlements = [];

        for (const [sId, items] of Object.entries(sellerItemsMap)) {
            // Check if settlement already exists for this order & seller
            const existing = await SellerSettlement.findOne({ orderId: order._id, sellerId: sId });
            if (existing) {
                generatedSettlements.push(existing);
                continue;
            }

            const seller = await User.findById(sId);
            const commRate = Number(seller?.sellerProfile?.commissionRate || 10);

            let sellerGross = 0;
            let sellerTaxable = 0;
            let sellerGST = 0;

            items.forEach(it => {
                const taxable = round((it.sellingPrice || 0) * (it.quantity || 1));
                const tax = round(it.sellingTaxAmount || 0) * (it.quantity || 1);
                sellerTaxable += taxable;
                sellerGST += tax;
                sellerGross += (it.totalLineAmount || (taxable + tax));
            });

            const baseCommission = round((sellerTaxable * commRate) / 100);
            const commissionGST = round(baseCommission * 0.18);
            const tcsAmount = round((sellerTaxable * 1) / 100); // 1% Sec 52
            const gatewayFee = round((sellerGross * 0.02)); // approx 2%
            const netPayout = round(sellerGross - (baseCommission + commissionGST + tcsAmount + gatewayFee));

            const settlement = new SellerSettlement({
                settlementId: 'STL-' + Date.now().toString().slice(-6) + '-' + Math.floor(100 + Math.random() * 900),
                sellerId: sId,
                orderId: order._id,
                orderCode: order.orderId || ('ORD-' + String(order._id).slice(-6)),
                grossSaleAmount: round(sellerGross),
                taxableSaleAmount: round(sellerTaxable),
                productGSTAmount: round(sellerGST),
                commissionRate: commRate,
                commissionAmount: baseCommission,
                commissionGSTAmount: commissionGST,
                tcsRate: 1,
                tcsAmount: tcsAmount,
                gatewayFeeAmount: gatewayFee,
                netPayoutAmount: netPayout,
                status: 'ready_for_payout',
                settlementDueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // T+7 days
            });

            await settlement.save();
            generatedSettlements.push(settlement);
        }

        res.status(200).json({ success: true, count: generatedSettlements.length, settlements: generatedSettlements });
    } catch (err) {
        console.error('[Generate Settlement Error]:', err);
        res.status(500).json({ success: false, message: 'Failed to generate settlement', error: err.message });
    }
});

// PATCH /api/sellers/admin/settlements/:id/disburse - Admin marks settlement as paid out
router.patch('/admin/settlements/:id/disburse', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { payoutReference } = req.body;
        const settlement = await SellerSettlement.findById(req.params.id);
        if (!settlement) {
            return res.status(404).json({ success: false, message: 'Settlement record not found' });
        }

        settlement.status = 'settled';
        settlement.payoutReference = payoutReference || ('UTR-' + Date.now());
        settlement.settledAt = new Date();
        await settlement.save();

        res.status(200).json({ success: true, message: 'Settlement marked as paid out', settlement });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to disburse settlement' });
    }
});

module.exports = router;
