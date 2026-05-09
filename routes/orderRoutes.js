const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const Order = require('../models/Order');
const Material = require('../models/Material');
const User = require('../models/User');
const Address = require('../models/Address');
const { verifyToken } = require('../middleware/authMiddleware');
const { updateUniversalLedger } = require('../utils/technicianFinanceHelper');
const { sendUserNotification, sendTopicNotification } = require('../utils/notificationHelper');

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// POST: Create Pending Order (Razorpay ID Generation)
router.post('/create', verifyToken, async (req, res) => {
    try {
        const { items, addressId, notes } = req.body; // items: [{ id, quantity }]
        
        if (!items || !items.length || !addressId) {
            return res.status(400).json({ message: 'Items and delivery address are required' });
        }

        const address = await Address.findById(addressId);
        if (!address) return res.status(404).json({ message: 'Address not found' });

        let totalAmount = 0;
        const orderItems = [];

        // Validate and Snapshot Items
        for (const item of items) {
            const material = await Material.findById(item.id);
            if (!material) return res.status(404).json({ message: `Material ${item.id} not found` });
            
            if (material.stockQuantity < item.quantity) {
                return res.status(400).json({ message: `Insufficient stock for ${material.name}` });
            }

            const sellingTaxAmount = Math.round((material.sellingPrice * material.sellingTaxRate) / 100);
            const lineAmount = (material.sellingPrice + sellingTaxAmount) * item.quantity;

            orderItems.push({
                materialId: material._id,
                name: material.name,
                make: material.make,
                quantity: item.quantity,
                sellingPrice: material.sellingPrice,
                sellingTaxRate: material.sellingTaxRate,
                sellingTaxAmount: sellingTaxAmount,
                totalLineAmount: lineAmount
            });

            totalAmount += lineAmount;
        }

        // Create Razorpay Order
        const options = {
            amount: Math.round(totalAmount * 100),
            currency: 'INR',
            receipt: `order_${Date.now()}`,
            notes: {
                userId: req.user.id,
                type: 'MATERIAL_PURCHASE'
            }
        };

        const rzpOrder = await razorpay.orders.create(options);

        // Save Local Pending Order
        const order = new Order({
            userId: req.user.id,
            items: orderItems,
            totalAmount,
            addressId,
            notes,
            razorpayOrderId: rzpOrder.id,
            paymentStatus: 'Pending'
        });

        await order.save();

        res.status(201).json({
            order,
            razorpayOrderId: rzpOrder.id,
            amount: options.amount,
            key_id: process.env.RAZORPAY_KEY_ID
        });

    } catch (err) {
        console.error('[Order Create] Error:', err);
        res.status(500).json({ message: 'Error creating order', error: err.message });
    }
});

// POST: Verify Payment and Complete Order
router.post('/verify', verifyToken, async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body;

        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({ message: 'Invalid payment signature' });
        }

        const order = await Order.findById(orderId);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        if (order.paymentStatus === 'Paid') {
            return res.status(400).json({ message: 'Order already paid' });
        }

        // 1. Update Order Status & Initialize Tracking
        order.paymentStatus = 'Paid';
        order.status = 'Confirmed';
        order.razorpayPaymentId = razorpay_payment_id;
        order.trackingHistory.push({
            status: 'Confirmed',
            message: 'Order placed successfully and payment verified.'
        });
        await order.save();

        // 2. Deduct Stock for each item
        for (const item of order.items) {
            await Material.findByIdAndUpdate(item.materialId, {
                $inc: { stockQuantity: -item.quantity }
            });
        }

        // 3. Record in Financial Ledger
        await updateUniversalLedger(
            order.userId,
            'MATERIAL_PURCHASE',
            -order.totalAmount,
            order.orderId,
            `Purchase of materials (Order #${order.orderId})`,
            { 
                orderId: order._id,
                itemsCount: order.items.length,
                razorpayPaymentId: razorpay_payment_id
            }
        ).catch(e => console.error('[Order Ledger] Error:', e));

        // 4. Notifications
        await sendUserNotification(
            order.userId,
            'Order Confirmed!',
            `Your material order #${order.orderId} has been successfully placed.`,
            { type: 'ORDER_CONFIRMED', orderId: order._id.toString() }
        );

        await sendTopicNotification(
            'admin',
            'New Material Order',
            `New standalone material order #${order.orderId} received.`,
            { orderId: order._id.toString() }
        );

        res.json({ message: 'Payment verified and order confirmed!', order });

    } catch (err) {
        console.error('[Order Verify] Error:', err);
        res.status(500).json({ message: 'Error verifying payment', error: err.message });
    }
});

// GET: All Orders for Admin/Employee/Engineer
router.get('/admin/all', verifyToken, async (req, res) => {
    try {
        if (!['admin', 'employee', 'engineer'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Unauthorized' });
        }
        const orders = await Order.find({})
            .sort({ createdAt: -1 })
            .populate('items.materialId', 'imageUrl unit name')
            .populate('userId', 'name phone email')
            .populate('deliveryBoyId', 'name phone')
            .populate('addressId');
        res.json(orders);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching admin orders', error: err.message });
    }
});

// GET: Delivery Boy Assigned Orders
router.get('/delivery/assigned', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'delivery') return res.status(403).json({ message: 'Unauthorized' });

        const orders = await Order.find({ deliveryBoyId: req.user.id })
            .sort({ createdAt: -1 })
            .populate('items.materialId', 'imageUrl unit name')
            .populate('userId', 'name phone email')
            .populate('addressId');
        res.json(orders);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching assigned orders', error: err.message });
    }
});

// GET: My Orders (Users)
router.get('/my-orders', verifyToken, async (req, res) => {
    try {
        let query = { userId: req.user.id };
        
        // Admins, Employees and Engineers can see all standalone orders
        if (['admin', 'employee', 'engineer'].includes(req.user.role)) {
            query = {};
        }

        const orders = await Order.find(query)
            .sort({ createdAt: -1 })
            .populate('items.materialId', 'imageUrl unit')
            .populate('userId', 'name phone email')
            .populate('addressId');
        res.json(orders);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching orders', error: err.message });
    }
});

// GET: Order Details by ID
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id)
            .populate('items.materialId', 'imageUrl unit make name')
            .populate('userId', 'name phone email')
            .populate('addressId');
            
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }
        
        // Security check: Admins/employees/engineers can view any, user can only view their own
        if (!['admin', 'employee', 'engineer'].includes(req.user.role) && order.userId._id.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Unauthorized to view this order' });
        }
        
        res.json(order);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching order details', error: err.message });
    }
});

// PATCH: Update Order Status
router.patch('/:id/status', verifyToken, async (req, res) => {
    try {
        if (!['admin', 'employee', 'engineer', 'delivery'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Unauthorized' });
        }

        const { status, trackingId, deliveryPartner, location, message } = req.body;
        const order = await Order.findById(req.params.id);
        
        if (!order) return res.status(404).json({ message: 'Order not found' });

        // Security check for delivery boy
        if (req.user.role === 'delivery' && order.deliveryBoyId?.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not assigned to this order' });
        }

        if (status) {
            order.status = status;
            order.trackingHistory.push({
                status,
                location: location || '',
                message: message || `Order status updated to ${status}`
            });
        }
        if (trackingId) order.trackingId = trackingId;
        if (deliveryPartner) order.deliveryPartner = deliveryPartner;

        await order.save();

        // Notify user of status change
        if (status) {
            await sendUserNotification(
                order.userId,
                `Order ${status}!`,
                `Your order #${order.orderId} status has been updated to ${status}.`,
                { type: 'ORDER_STATUS_UPDATE', orderId: order._id.toString(), status }
            );
        }

        res.json({ message: 'Order updated successfully', order });
    } catch (err) {
        res.status(500).json({ message: 'Error updating order', error: err.message });
    }
});

// PATCH: Assign Delivery
router.patch('/:id/assign-delivery', verifyToken, async (req, res) => {
    try {
        if (!['admin', 'employee', 'engineer'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Unauthorized' });
        }

        const { deliveryMode, deliveryBoyId, logisticsPartner } = req.body;
        const order = await Order.findById(req.params.id);
        
        if (!order) return res.status(404).json({ message: 'Order not found' });

        order.deliveryMode = deliveryMode;

        if (deliveryMode === 'Internal') {
            order.deliveryBoyId = deliveryBoyId;
            order.logisticsPartner = null;
            order.externalTrackingId = null;
            
            // Push tracking history
            order.trackingHistory.push({
                status: order.status,
                message: 'Assigned to internal delivery partner'
            });
        } else if (deliveryMode === 'External') {
            order.deliveryBoyId = null;
            order.logisticsPartner = logisticsPartner;
            
            // MOCK EXTERNAL API CALL
            // Here you would fetch the API key from LogisticsConfig
            // const LogisticsConfig = require('../models/LogisticsConfig');
            // const config = await LogisticsConfig.findOne({ providerName: logisticsPartner });
            // const response = await axios.post('https://api.porter.in/v1/orders', { ...orderData }, { headers: { Authorization: `Bearer ${config.apiKey}` } });
            
            // Mocking the response tracking ID for now
            order.externalTrackingId = `${logisticsPartner.toUpperCase()}-${Math.floor(Math.random() * 1000000)}`;
            
            order.trackingHistory.push({
                status: order.status,
                message: `Assigned to external logistics: ${logisticsPartner} (Tracking: ${order.externalTrackingId})`
            });
        }

        await order.save();
        res.json({ message: 'Delivery assigned successfully', order });
    } catch (err) {
        res.status(500).json({ message: 'Error assigning delivery', error: err.message });
    }
});

module.exports = router;
