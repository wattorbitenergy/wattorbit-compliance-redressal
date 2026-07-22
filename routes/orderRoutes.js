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
const { sendMail } = require('./mailer');

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// POST: Create Pending Order (Razorpay ID Generation)
router.post('/create', verifyToken, async (req, res) => {
    try {
        let { items, addressId, notes, paymentMethod = 'Online', deliveryFee = 0 } = req.body; // items: [{ id, quantity }]
        deliveryFee = Number(deliveryFee) || 0;
        
        if (paymentMethod && paymentMethod.toLowerCase() === 'online') paymentMethod = 'Online';
        if (paymentMethod && paymentMethod.toLowerCase() === 'cod') paymentMethod = 'COD';

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

        // Add delivery fee to total
        totalAmount += deliveryFee;

        let codCharge = 0;
        if (paymentMethod === 'COD') {
            codCharge = 20;
            totalAmount += codCharge;
        }

        if (paymentMethod === 'Online') {
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
                deliveryFee,
                addressId,
                notes,
                paymentMethod,
                codCharge,
                razorpayOrderId: rzpOrder.id,
                paymentStatus: 'Pending'
            });

            await order.save();

            return res.status(201).json({
                order,
                razorpayOrderId: rzpOrder.id,
                amount: options.amount,
                key_id: process.env.RAZORPAY_KEY_ID
            });
        } else {
            // COD Logic: Order is confirmed immediately, stock deducted
            const order = new Order({
                userId: req.user.id,
                items: orderItems,
                totalAmount,
                deliveryFee,
                addressId,
                notes,
                paymentMethod,
                codCharge,
                paymentStatus: 'Pending', // pending until delivered
                status: 'Confirmed'
            });

            await order.save();

            // Deduct Stock
            for (const item of order.items) {
                await Material.findByIdAndUpdate(item.materialId, {
                    $inc: { stockQuantity: -item.quantity }
                });
            }

            // Notifications
            await sendUserNotification(
                order.userId,
                'Order Confirmed!',
                `Your COD material order #${order.orderId} has been successfully placed.`,
                { type: 'ORDER_CONFIRMED', orderId: order._id.toString() }
            );

            await sendTopicNotification(
                'admin',
                'New Material Order (COD)',
                `New COD material order #${order.orderId} received.`,
                { orderId: order._id.toString() }
            );

            // Send Emails
            const adminEmail = process.env.ADMIN_EMAIL || 'support@wattorbit.in';
            const user = await User.findById(order.userId);
            const emailHtml = `
                <h2>New Order Received (COD)</h2>
                <p>Order ID: ${order.orderId}</p>
                <p>Total Amount: ₹${order.totalAmount}</p>
                <p>Payment Method: COD</p>
                <p>Items: ${order.items.length}</p>
            `;
            sendMail({
                to: adminEmail,
                subject: \`New COD Order #\${order.orderId}\`,
                html: emailHtml
            }).catch(console.error);
            
            if (user?.email) {
                sendMail({
                    to: user.email,
                    subject: \`Order Confirmed #\${order.orderId}\`,
                    html: \`<h2>Your WattOrbit Order is Confirmed!</h2>
                           <p>Thank you for your order! Your Order ID is <b>\${order.orderId}</b>.</p>
                           <p>Total Amount to be paid on delivery: ₹\${order.totalAmount}</p>\`
                }).catch(console.error);
            }

            return res.status(201).json({
                order,
                message: 'Order Confirmed!'
            });
        }

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

        // 1. Update Order Status
        order.paymentStatus = 'Paid';
        order.razorpayPaymentId = razorpay_payment_id;
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

        // Send Emails
        const adminEmail = process.env.ADMIN_EMAIL || 'support@wattorbit.in';
        const user = await User.findById(order.userId);
        const emailHtml = `
            <h2>New Order Received (Paid Online)</h2>
            <p>Order ID: ${order.orderId}</p>
            <p>Total Amount: ₹${order.totalAmount}</p>
            <p>Payment Method: Online</p>
            <p>Payment ID: ${razorpay_payment_id}</p>
            <p>Items: ${order.items.length}</p>
        `;
        sendMail({
            to: adminEmail,
            subject: \`New Paid Order #\${order.orderId}\`,
            html: emailHtml
        }).catch(console.error);
        
        if (user?.email) {
            sendMail({
                to: user.email,
                subject: \`Payment Successful & Order Confirmed #\${order.orderId}\`,
                html: \`<h2>Your WattOrbit Order is Confirmed!</h2>
                       <p>Thank you for your order! Your payment was successful.</p>
                       <p>Order ID: <b>\${order.orderId}</b></p>
                       <p>Amount Paid: ₹\${order.totalAmount}</p>\`
            }).catch(console.error);
        }

        res.json({ message: 'Payment verified and order confirmed!', order });

    } catch (err) {
        console.error('[Order Verify] Error:', err);
        res.status(500).json({ message: 'Error verifying payment', error: err.message });
    }
});

// GET: My Orders (Admins see all)
router.get('/my-orders', verifyToken, async (req, res) => {
    try {
        let query = { userId: req.user.id };
        
        // Admins and Employees can see all standalone orders
        if (['admin', 'employee'].includes(req.user.role)) {
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


// GET: Fetch Single Order by ID
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id)
            .populate('items.materialId', 'imageUrl unit name make')
            .populate('userId', 'name phone email')
            .populate('addressId');
            
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Check if the user is authorized to view this order
        if (order.userId._id.toString() !== req.user.id && !['admin', 'employee'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Unauthorized' });
        }

        res.json(order);
    } catch (err) {
        console.error('[Get Order By ID] Error:', err);
        res.status(500).json({ message: 'Error fetching order', error: err.message });
    }
});

// PATCH: Cancel Order (User or Admin)
router.patch('/:id/cancel', verifyToken, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        // Authorization: Must be the order owner, or admin/employee
        if (order.userId.toString() !== req.user.id && !['admin', 'employee'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Unauthorized to cancel this order' });
        }

        // Check if order can be cancelled
        if (['Cancelled', 'Dispatched', 'Delivered'].includes(order.status)) {
            return res.status(400).json({ message: `Cannot cancel an order that is ${order.status}` });
        }

        order.status = 'Cancelled';
        order.notes = req.body.message ? `${order.notes || ''}\n${req.body.message}`.trim() : order.notes;

        if (order.paymentStatus === 'Paid') {
            order.paymentStatus = 'Refunded';
            
            // Revert ledger entry
            await updateUniversalLedger(
                order.userId,
                'MATERIAL_PURCHASE_REFUND',
                order.totalAmount, // Give back the money
                order.orderId,
                `Refund for cancelled order #${order.orderId}`,
                { 
                    orderId: order._id,
                    razorpayPaymentId: order.razorpayPaymentId
                }
            ).catch(e => console.error('[Order Ledger Refund] Error:', e));
        }

        await order.save();

        // Revert Stock
        for (const item of order.items) {
            await Material.findByIdAndUpdate(item.materialId, {
                $inc: { stockQuantity: item.quantity }
            });
        }

        // Notify user
        await sendUserNotification(
            order.userId,
            'Order Cancelled',
            `Your order #${order.orderId} has been cancelled successfully.`,
            { type: 'ORDER_CANCELLED', orderId: order._id.toString() }
        );

        res.json({ message: 'Order cancelled successfully', order });
    } catch (err) {
        console.error('[Cancel Order] Error:', err);
        res.status(500).json({ message: 'Error cancelling order', error: err.message });
    }
});

// PATCH: Update Order Status (Admin/Employee Only)
router.patch('/:id/status', verifyToken, async (req, res) => {
    try {
        if (!['admin', 'employee'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Unauthorized' });
        }

        const { status, trackingId, deliveryPartner } = req.body;
        const order = await Order.findById(req.params.id);
        
        if (!order) return res.status(404).json({ message: 'Order not found' });

        if (status) order.status = status;
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

module.exports = router;
