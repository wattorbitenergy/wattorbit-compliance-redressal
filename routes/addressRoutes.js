const express = require('express');
const router = express.Router();
const Address = require('../models/Address');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

// Verify token middleware
const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authorization header missing or invalid' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // Ensure id is available even if signed differently (legacy or varied)
        req.user = {
            ...decoded,
            id: decoded.id || decoded._id
        };
        next();
    } catch (err) {
        console.error('JWT Verify Error:', err.message);
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
};

// 🚀 DEBUG MIDDLEWARE: Log every request to this router (MOVE TO TOP)
router.use((req, res, next) => {
    console.log(`[AddressRouter] ${req.method} ${req.path}`, {
        user: req.user ? req.user.id : 'anonymous',
        body: req.method === 'POST' ? 'BODY_DATA_PRESENT' : 'N/A'
    });
    next();
});

// GET: Simple Ping (Public)
router.get('/ping', (req, res) => {
    res.json({ message: 'Address router is mounted and responding', timestamp: new Date() });
});

// POST: Echo Body (Public - for debugging parser issues)
router.post('/ping-post', (req, res) => {
    res.json({ message: 'POST reaching address router', body: req.body, timestamp: new Date() });
});

// Diagnostic: Health Check (Admin Only)
router.get('/diagnostic/health', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required for diagnostics' });
    }
    try {
        console.log('--- DIAGNOSTIC HEALTH CHECK START ---');
        const count = await Address.countDocuments();

        // Trial Op: Create a dummy record and delete it
        const testAddr = new Address({
            userId: new mongoose.Types.ObjectId(),
            street: 'Diagnostic Test',
            city: 'Test City',
            state: 'Test State',
            pincode: '000000'
        });
        await testAddr.save();
        await Address.findByIdAndDelete(testAddr._id);

        res.json({
            status: 'ok',
            timestamp: new Date(),
            message: 'Address routes are active',
            database: 'connected',
            write_status: 'ok',
            count
        });
    } catch (err) {
        console.error('❌ Diagnostic Health Check Failed:', err);
        res.status(500).json({
            status: 'error',
            message: 'Database connection or model issue',
            error: err.message,
            stack: err.stack
        });
    }
});

// POST: Add new address
router.post('/', verifyToken, async (req, res) => {
    try {
        const {
            addressType, label, flatNo, building, street, landmark,
            city, state, pincode, contactName, contactPhone, coordinates, isDefault
        } = req.body;

        // Logging for Render
        console.log('--- POST ADDRESS ATTEMPT ---');
        console.log('Payload:', JSON.stringify(req.body));
        console.log('User ID from token:', req.user?.id);

        // Validation
        if (!street || !city || !state || !pincode) {
            return res.status(400).json({
                message: 'Missing required fields: street, city, state, pincode'
            });
        }

        // Safety check for req.user
        if (!req.user || !req.user.id) {
            console.error('❌ Address POST Error: User ID missing from token');
            return res.status(401).json({ message: 'User identification failed. Please log in again.' });
        }

        // 🛡️ CRITICAL FIX: Explicitly cast to ObjectId
        // This prevents errors if req.user.id is passed as a string/buffer/etc that Mongoose dislikes
        let userId;
        try {
            userId = new mongoose.Types.ObjectId(req.user.id);
        } catch (idErr) {
            console.error('❌ Address POST Error: Could not cast User ID to ObjectId:', req.user.id);
            return res.status(400).json({ message: 'Invalid user identity format', error: idErr.message });
        }

        const addressData = {
            userId,
            addressType: addressType || 'Home',
            label: label || 'My Address',
            flatNo, building, street, landmark,
            city, state, pincode,
            contactName, contactPhone, coordinates,
            isDefault: isDefault || false
        };

        const address = new Address(addressData);
        await address.save();

        console.log('✅ Address saved successfully:', address._id);

        res.status(201).json({
            message: 'Address added successfully',
            address
        });
    } catch (err) {
        console.error('❌ Address POST Crash:', err);

        // Handle Mongoose Validation Errors specifically
        if (err.name === 'ValidationError') {
            const messages = Object.values(err.errors).map(e => e.message);
            return res.status(400).json({
                message: 'Validation failed',
                errors: messages
            });
        }

        res.status(500).json({
            message: 'Failed to add address',
            error: err.message,
            stack: err.stack,
            type: err.name
        });
    }
});

// GET: Get user's addresses
router.get('/', verifyToken, async (req, res) => {
    try {
        const addresses = await Address.find({
            userId: req.user.id,
            isActive: true
        }).sort({ isDefault: -1, createdAt: -1 });

        res.json(addresses);
    } catch (err) {
        console.error('Error fetching addresses:', err);
        res.status(500).json({ message: 'Failed to fetch addresses', error: err.message });
    }
});

// GET: Get address details
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const address = await Address.findById(req.params.id);

        if (!address) {
            return res.status(404).json({ message: 'Address not found' });
        }

        // Check if address belongs to user
        if (address.userId.toString() !== req.user.id.toString()) {
            return res.status(403).json({ message: 'Access denied' });
        }

        res.json(address);
    } catch (err) {
        console.error('Error fetching address:', err);
        return res.status(500).json({ message: 'Failed to fetch address details', error: err.message });
    }
});

// PATCH: Set as default address
router.patch('/:id/set-default', verifyToken, async (req, res) => {
    try {
        const address = await Address.findById(req.params.id);

        if (!address) {
            return res.status(404).json({ message: 'Address not found' });
        }

        // Check if address belongs to user
        if (address.userId.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Set this as default (pre-save hook will unset others)
        address.isDefault = true;
        await address.save();

        res.json({ message: 'Default address set successfully', address });
    } catch (err) {
        console.error('Error setting default address:', err);
        return res.status(500).json({ message: 'Failed to set default address', error: err.message });
    }
});

// PUT: Update address
router.put('/:id', verifyToken, async (req, res) => {
    try {
        const {
            addressType,
            label,
            flatNo,
            building,
            street,
            landmark,
            city,
            state,
            pincode,
            contactName,
            contactPhone,
            coordinates
        } = req.body;

        const address = await Address.findById(req.params.id);

        if (!address) {
            return res.status(404).json({ message: 'Address not found' });
        }

        // Check if address belongs to user
        if (address.userId.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Update fields
        if (addressType) address.addressType = addressType;
        if (label) address.label = label;
        if (flatNo !== undefined) address.flatNo = flatNo;
        if (building !== undefined) address.building = building;
        if (street) address.street = street;
        if (landmark !== undefined) address.landmark = landmark;
        if (city) address.city = city;
        if (state) address.state = state;
        if (pincode) address.pincode = pincode;
        if (contactName !== undefined) address.contactName = contactName;
        if (contactPhone !== undefined) address.contactPhone = contactPhone;
        if (coordinates) address.coordinates = coordinates;

        await address.save();

        res.json({ message: 'Address updated successfully', address });
    } catch (err) {
        console.error('Error updating address:', err);
        res.status(500).json({ message: 'Failed to update address' });
    }
});

// DELETE: Delete address
router.delete('/:id', verifyToken, async (req, res) => {
    try {
        const address = await Address.findById(req.params.id);

        if (!address) {
            return res.status(404).json({ message: 'Address not found' });
        }

        // Check if address belongs to user
        if (address.userId.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Soft delete
        address.isActive = false;
        await address.save();

        res.json({ message: 'Address deleted successfully' });
    } catch (err) {
        console.error('Error deleting address:', err);
        res.status(500).json({ message: 'Failed to delete address' });
    }
});

module.exports = router;
