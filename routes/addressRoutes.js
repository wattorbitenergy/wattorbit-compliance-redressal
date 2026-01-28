const express = require('express');
const router = express.Router();
const Address = require('../models/Address');
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

// POST: Add new address
router.post('/', verifyToken, async (req, res) => {
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
            coordinates,
            isDefault
        } = req.body;

        // Validation
        if (!street || !city || !state || !pincode) {
            return res.status(400).json({
                message: 'Missing required fields: street, city, state, pincode'
            });
        }

        const address = new Address({
            userId: req.user.id,
            addressType: addressType || 'Home',
            label: label || 'My Address',
            flatNo,
            building,
            street,
            landmark,
            city,
            state,
            pincode,
            contactName,
            contactPhone,
            coordinates,
            isDefault: isDefault || false
        });

        await address.save();

        res.status(201).json({
            message: 'Address added successfully',
            address
        });
    } catch (err) {
        console.error('Error adding address:', err);
        res.status(500).json({ message: 'Failed to add address' });
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
        res.status(500).json({ message: 'Failed to fetch addresses' });
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
        if (address.userId.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Access denied' });
        }

        res.json(address);
    } catch (err) {
        console.error('Error fetching address:', err);
        res.status(500).json({ message: 'Failed to fetch address' });
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
        res.status(500).json({ message: 'Failed to set default address' });
    }
});

module.exports = router;
