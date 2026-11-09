const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const Order = require('../models/Order');
const Material = require('../models/Material');
const User = require('../models/User');
const Address = require('../models/Address');
const { verifyToken } = require('../middleware/authMiddleware');
const { updateUniversalLedger } = require('../utils/technicianFinanceHelper');
const { sendUserNotification, sendTopicNotification, sendOrderLifecycleNotification } = require('../utils/notificationHelper');
const { sendMail } = require('./mailer');
const Config = require('../models/Config');
const Invoice = require('../models/Invoice');
const { generateInvoiceId } = require('../utils/idGenerator');
const { convertNumberToWords } = require('../utils/numberToWords');
const { generateInvoicePDF } = require('../utils/invoicePDFGenerator');
const { verifyAndEnrichInvoiceCompliance } = require('../utils/complianceEngine');
const { uploadToCloudinary } = require('../utils/cloudinaryHelper');
const { createShipment, trackShipment, cancelShipment } = require('../services/delhiveryService');
const LogisticsConfig = require('../models/LogisticsConfig');

const fs = require('fs');
const path = require('path');

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Helper to find order by Mongo _id OR custom orderId (e.g. ORD-2611-1002)
const getOrderByIdOrOrderId = async (id, populateOptions = []) => {
    if (!id) return null;
    const isObjectId = mongoose.Types.ObjectId.isValid(id);
    let query = Order.findOne(isObjectId ? { $or: [{ _id: id }, { orderId: id }] } : { orderId: id });
    for (const pop of populateOptions) {
        query = query.populate(pop);
    }
    return await query;
};

// POST: Create Pending Order (Razorpay ID Generation)
router.post('/create', verifyToken, async (req, res) => {
    try {
        let { items, addressId, notes, paymentMethod = 'Online', deliveryFee = 0, couponDiscount = 0 } = req.body; // items: [{ id, quantity }]
        deliveryFee = Number(deliveryFee) || 0;
        couponDiscount = Number(couponDiscount) || 0;
        
        if (paymentMethod) {
            const pm = paymentMethod.toString().trim().toLowerCase();
            if (['online', 'upi', 'card', 'netbanking'].includes(pm)) {
                paymentMethod = 'Online';
            } else if (pm === 'cod') {
                paymentMethod = 'COD';
            }
        }

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

        // Subtract cart coupon discount
        if (couponDiscount > 0) {
            totalAmount = Math.max(0, totalAmount - couponDiscount);
        }

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
                couponDiscount,
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
                couponDiscount,
                addressId,
                notes,
                paymentMethod,
                codCharge,
                paymentStatus: 'Pending', // pending until delivered
                status: 'Confirmed'
            });

            await order.save();

            // Deduct Stock with atomic conditional update & rollback on insufficient inventory
            const deductedItems = [];
            let stockFailed = false;
            let failedItemName = '';

            for (const item of order.items) {
                const updated = await Material.findOneAndUpdate(
                    { _id: item.materialId, stockQuantity: { $gte: item.quantity } },
                    { $inc: { stockQuantity: -item.quantity } },
                    { new: true }
                );

                if (!updated) {
                    stockFailed = true;
                    failedItemName = item.name;
                    break;
                }
                deductedItems.push({ materialId: item.materialId, quantity: item.quantity });
            }

            if (stockFailed) {
                // Rollback any stock that was decremented
                for (const rollback of deductedItems) {
                    await Material.findByIdAndUpdate(rollback.materialId, {
                        $inc: { stockQuantity: rollback.quantity }
                    });
                }
                await Order.findByIdAndDelete(order._id);
                return res.status(400).json({ 
                    message: `Item "${failedItemName}" ran out of stock. Order could not be placed.` 
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
                subject: `New COD Order #${order.orderId}`,
                html: emailHtml
            }).catch(console.error);
            
            if (user?.email) {
                sendMail({
                    to: user.email,
                    subject: `Order Confirmed #${order.orderId}`,
                    html: `<h2>Your WattOrbit Order is Confirmed!</h2>
                           <p>Thank you for your order! Your Order ID is <b>${order.orderId}</b>.</p>
                           <p>Total Amount to be paid on delivery: ₹${order.totalAmount}</p>`
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

        // 2. Deduct Stock for each item (Atomic decrement)
        for (const item of order.items) {
            await Material.findOneAndUpdate(
                { _id: item.materialId },
                { $inc: { stockQuantity: -item.quantity } }
            );
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
            subject: `New Paid Order #${order.orderId}`,
            html: emailHtml
        }).catch(console.error);
        
        if (user?.email) {
            sendMail({
                to: user.email,
                subject: `Payment Successful & Order Confirmed #${order.orderId}`,
                html: `<h2>Your WattOrbit Order is Confirmed!</h2>
                       <p>Thank you for your order! Your payment was successful.</p>
                       <p>Order ID: <b>${order.orderId}</b></p>
                       <p>Amount Paid: ₹${order.totalAmount}</p>`
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



// GET: My Delivery Assignments (Internal Fleet)
router.get('/delivery/my-assignments', verifyToken, async (req, res) => {
    try {
        const orders = await Order.find({ assignedTo: req.user.id, status: { $nin: ['Delivered', 'Cancelled'] } })
            .sort({ createdAt: -1 })
            .populate('items.materialId', 'imageUrl unit name make')
            .populate('userId', 'name phone email')
            .populate('addressId');
            
        const config = await Config.findOne({ key: 'warehouse_details' });
        let warehouseDetails = null;
        if (config && config.value) {
            try { warehouseDetails = JSON.parse(config.value); } catch(e){}
        }

        res.json({ orders, warehouseDetails });
    } catch (err) {
        console.error('[Delivery Assignments] Error:', err);
        res.status(500).json({ message: 'Error fetching assignments', error: err.message });
    }
});

// GET: Check Pincode Serviceability (Automated City-Wise Coverage Engine)
router.get('/check-pincode', async (req, res) => {
    try {
        const { pincode } = req.query;
        if (!pincode || pincode.length !== 6 || !/^\d{6}$/.test(pincode)) {
            return res.status(400).json({ available: false, message: 'Invalid PIN code. Must be a 6-digit number.' });
        }

        const { checkServiceability } = require('../services/pincodeService');
        const result = await checkServiceability(pincode);
        return res.json(result);
    } catch (err) {
        console.error('[Check Pincode] Error:', err);
        res.status(500).json({ available: false, message: 'Error checking PIN code' });
    }
});


// POST: Assign Delivery
router.post('/:id/assign-delivery', verifyToken, async (req, res) => {
    try {
        if (!['admin', 'employee'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Unauthorized' });
        }

        const { deliveryType, assignedTo } = req.body;
        const order = await getOrderByIdOrOrderId(req.params.id, ['addressId', 'userId']);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        if (deliveryType === 'internal') {
            if (!assignedTo) return res.status(400).json({ message: 'assignedTo is required for internal delivery' });
            const assignedUser = await User.findById(assignedTo);
            if (!assignedUser) return res.status(404).json({ message: 'Assigned user not found' });

            order.deliveryType = 'internal';
            order.assignedTo = assignedTo;
            order.status = 'Processing';
            order.deliveryPartner = assignedUser.name;
            order.trackingHistory.push({
                status: 'Assigned',
                message: `Assigned to ${assignedUser.name}`,
                location: 'Warehouse',
                timestamp: new Date()
            });
            await order.save();

            // Notify delivery person
            await sendUserNotification(
                assignedTo,
                'New Delivery Assigned',
                `Order #${order.orderId} has been assigned to you.`,
                { type: 'DELIVERY_ASSIGNED', orderId: order._id.toString() }
            );

            // Notify customer of order processing
            sendOrderLifecycleNotification(order, 'ORDER_PROCESSING', {
                partner: assignedUser.name
            }).catch(e => console.error('[Internal Delivery Notification] Error:', e.message));

            return res.json({ message: 'Delivery assigned to internal partner', order });
        } 
        else if (deliveryType === 'delhivery') {
            const config = await Config.findOne({ key: 'warehouse_details' });
            let warehouseDetails = {};
            if (config && config.value) {
                try { warehouseDetails = JSON.parse(config.value); } catch(e){}
            }

            const itemDesc = order.items.map(i => i.name).join(', ');
            const totalQty = order.items.reduce((sum, i) => sum + i.quantity, 0);

            try {
                const result = await createShipment({
                    orderId: order.orderId,
                    pickupDetails: warehouseDetails,
                    deliveryDetails: {
                        name: order.userId.name,
                        phone: order.addressId.contactPhone || order.userId.phone,
                        address: `${order.addressId.flatNo || ''} ${order.addressId.building || ''} ${order.addressId.street || ''}`,
                        city: order.addressId.city,
                        state: order.addressId.state,
                        pincode: order.addressId.pincode
                    },
                    packageDetails: {
                        name: itemDesc,
                        quantity: totalQty,
                        weight: 500, // Default weight
                        payment_mode: order.paymentMethod === 'COD' ? 'COD' : 'Prepaid',
                        cod_amount: order.paymentMethod === 'COD' ? order.totalAmount : 0
                    }
                });

                if (result.success) {
                    order.deliveryType = 'delhivery';
                    order.awbNumber = result.awb;
                    order.shipmentId = result.shipment_id;
                    order.trackingId = result.awb;
                    order.deliveryPartner = 'Delhivery';
                    order.status = 'Dispatched';
                    order.trackingHistory.push({
                        status: 'Shipment Created',
                        message: `AWB: ${result.awb}`,
                        location: 'Warehouse',
                        timestamp: new Date()
                    });
                    await order.save();

                    // Notify customer
                    sendOrderLifecycleNotification(order, 'ORDER_DISPATCHED', {
                        partner: 'Delhivery',
                        trackingId: result.awb
                    }).catch(e => console.error('[Delhivery Notification] Error:', e.message));

                    return res.json({ message: 'Shipment booked on Delhivery', order, awb: result.awb });
                } else {
                    return res.status(400).json({ message: result.message || 'Failed to book Delhivery' });
                }
            } catch (apiError) {
                return res.status(500).json({ message: apiError.message });
            }
        }
        else if (['custom', 'manual', 'porter', 'external'].includes(deliveryType)) {
            const { partnerName, trackingId, partnerPhone, notes } = req.body;
            if (!partnerName && !req.body.deliveryPartner) {
                return res.status(400).json({ message: 'Courier / Partner name is required' });
            }

            const chosenPartner = (partnerName || req.body.deliveryPartner || 'Custom Courier').trim();
            const chosenTracking = (trackingId || '').trim();
            const chosenPhone = (partnerPhone || '').trim();

            order.deliveryType = deliveryType;
            order.deliveryPartner = chosenPartner;
            if (chosenTracking) order.trackingId = chosenTracking;
            if (chosenPhone) order.deliveryPartnerContact = chosenPhone;
            order.status = 'Dispatched';
            
            order.trackingHistory.push({
                status: 'Dispatched',
                message: `Assigned & dispatched via ${chosenPartner}${chosenTracking ? ` (Tracking: ${chosenTracking})` : ''}${notes ? `. ${notes}` : ''}`,
                location: 'Warehouse / Fulfillment Hub',
                timestamp: new Date()
            });

            await order.save();

            // Notify customer via App, SMS, and Email
            sendOrderLifecycleNotification(order, 'ORDER_DISPATCHED', {
                partner: chosenPartner,
                trackingId: chosenTracking,
                partnerPhone: chosenPhone
            }).catch(e => console.error('[Assign Delivery Notification] Error:', e.message));

            return res.json({ message: `Order assigned and dispatched via ${chosenPartner}`, order });
        }
        else {
            return res.status(400).json({ message: 'Invalid delivery type. Must be internal, delhivery, or custom/porter/manual' });
        }
    } catch (err) {
        console.error('[Assign Delivery] Error:', err);
        res.status(500).json({ message: 'Error assigning delivery', error: err.message });
    }
});

// GET: Track Order
router.get('/:id/track', verifyToken, async (req, res) => {
    try {
        const order = await getOrderByIdOrOrderId(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        // Auth check: owner, admin, employee, or assigned delivery person
        if (order.userId.toString() !== req.user.id && !['admin', 'employee'].includes(req.user.role) && order.assignedTo?.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Unauthorized' });
        }

        if (order.deliveryType === 'delhivery' && order.awbNumber) {
            try {
                const liveData = await trackShipment(order.awbNumber);
                return res.json({ trackingHistory: order.trackingHistory, liveData });
            } catch (e) {
                // Return local history if API fails
                return res.json({ trackingHistory: order.trackingHistory, error: 'Could not fetch live Delhivery tracking' });
            }
        }

        return res.json({ trackingHistory: order.trackingHistory });
    } catch (err) {
        console.error('[Track Order] Error:', err);
        res.status(500).json({ message: 'Error fetching tracking', error: err.message });
    }
});

// GET: Fetch Single Order by ID
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const order = await getOrderByIdOrOrderId(req.params.id, [
            { path: 'items.materialId', select: 'imageUrl unit name make' },
            { path: 'userId', select: 'name phone email' },
            'addressId'
        ]);
            
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
        const order = await getOrderByIdOrOrderId(req.params.id);
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
        const order = await getOrderByIdOrOrderId(req.params.id);
        
        if (!order) return res.status(404).json({ message: 'Order not found' });

        if (status) order.status = status;
        if (trackingId) order.trackingId = trackingId;
        if (deliveryPartner) order.deliveryPartner = deliveryPartner;

        await order.save();

        // AUTO-GENERATE INVOICE when status changes to Delivered
        if (status === 'Delivered' && !order.invoiceUrl) {
            try {
                // Populate order for invoice generation
                const fullOrder = await Order.findById(order._id)
                    .populate('userId')
                    .populate('addressId');

                // Check if invoice already exists
                const existingInvoice = await Invoice.findOne({ orderRefId: order._id });
                if (!existingInvoice) {
                    // Build invoice data (same logic as invoiceRoutes generate-order)
                    const bankConfig = await Config.findOne({ key: 'bank_details' });
                    const biz = bankConfig?.value || {};
                    const sellerState = 'Uttar Pradesh';
                    const sellerStateCode = '09';
                    const buyerState = fullOrder.addressId?.state || '';
                    const isIntrastate = buyerState.toLowerCase().includes(sellerState.toLowerCase()) ||
                                         buyerState.toLowerCase().includes('u.p') ||
                                         buyerState.toLowerCase().includes('up');

                    const generatedInvoiceId = await generateInvoiceId();
                    const invoiceItems = [];
                    let totalTaxable = 0, totalCGST = 0, totalSGST = 0, totalIGST = 0;

                    if (fullOrder.items && fullOrder.items.length > 0) {
                        fullOrder.items.forEach(m => {
                            const taxableValue = m.sellingPrice * m.quantity;
                            const rate = m.sellingTaxRate || 0;
                            let cgst = 0, sgst = 0, igst = 0;
                            if (rate > 0) {
                                if (isIntrastate) {
                                    cgst = parseFloat((taxableValue * (rate / 2) / 100).toFixed(2));
                                    sgst = parseFloat((taxableValue * (rate / 2) / 100).toFixed(2));
                                } else {
                                    igst = parseFloat((taxableValue * rate / 100).toFixed(2));
                                }
                            }
                            invoiceItems.push({
                                description: `${m.name} (${m.make})`,
                                hsnSac: '',
                                quantity: m.quantity,
                                unitPrice: m.sellingPrice,
                                taxableValue, taxRate: rate,
                                cgstRate: isIntrastate ? rate / 2 : 0, cgstAmount: cgst,
                                sgstRate: isIntrastate ? rate / 2 : 0, sgstAmount: sgst,
                                igstRate: isIntrastate ? 0 : rate, igstAmount: igst,
                                taxAmount: cgst + sgst + igst,
                                total: taxableValue + cgst + sgst + igst
                            });
                            totalTaxable += taxableValue;
                            totalCGST += cgst; totalSGST += sgst; totalIGST += igst;
                        });
                    }

                    // COD charge line item
                    if (fullOrder.codCharge > 0) {
                        const preTaxCod = parseFloat((fullOrder.codCharge / 1.18).toFixed(2));
                        const codTax = fullOrder.codCharge - preTaxCod;
                        let cgst = 0, sgst = 0, igst = 0;
                        if (isIntrastate) { cgst = parseFloat((codTax / 2).toFixed(2)); sgst = parseFloat((codTax / 2).toFixed(2)); }
                        else { igst = parseFloat(codTax.toFixed(2)); }
                        invoiceItems.push({
                            description: 'COD Handling Charge', hsnSac: '999999', quantity: 1,
                            unitPrice: preTaxCod, taxableValue: preTaxCod, taxRate: 18,
                            cgstRate: isIntrastate ? 9 : 0, cgstAmount: cgst,
                            sgstRate: isIntrastate ? 9 : 0, sgstAmount: sgst,
                            igstRate: isIntrastate ? 0 : 18, igstAmount: igst,
                            taxAmount: cgst + sgst + igst, total: preTaxCod + cgst + sgst + igst
                        });
                        totalTaxable += preTaxCod; totalCGST += cgst; totalSGST += sgst; totalIGST += igst;
                    }

                    const grandTotal = parseFloat((totalTaxable + totalCGST + totalSGST + totalIGST).toFixed(2));
                    const amountWords = convertNumberToWords(grandTotal);
                    const addr = fullOrder.addressId;
                    const customerAddress = `${addr?.flatNo ? addr.flatNo + ', ' : ''}${addr?.building ? addr.building + ', ' : ''}${addr?.street || ''}, ${addr?.landmark ? addr.landmark + ', ' : ''}${addr?.city || ''}, ${addr?.state || ''} - ${addr?.pincode || ''}`;

                    // Check if order items belong to an external seller
                    let primarySeller = null;
                    if (fullOrder.items && fullOrder.items.length > 0 && fullOrder.items[0].materialId) {
                        try {
                            const firstMat = await Material.findById(fullOrder.items[0].materialId).populate('sellerId');
                            if (firstMat && firstMat.sellerId && firstMat.sellerId.sellerProfile?.gstin) {
                                primarySeller = firstMat.sellerId;
                            }
                        } catch (e) {
                            console.warn('[Auto-Invoice] Could not check seller attribution:', e.message);
                        }
                    }

                    const isMarketplace = Boolean(primarySeller);
                    const sellerProf = primarySeller?.sellerProfile || {};

                    const invoicePayload = {
                        invoiceId: generatedInvoiceId,
                        orderRefId: order._id,
                        userId: fullOrder.userId._id,
                        invoiceDate: fullOrder.createdAt || new Date(),
                        items: invoiceItems,
                        subtotal: parseFloat(totalTaxable.toFixed(2)),
                        taxAmount: parseFloat((totalCGST + totalSGST + totalIGST).toFixed(2)),
                        discount: 0,
                        totalAmount: grandTotal,
                        amountInWords: amountWords,
                        totalCGST: parseFloat(totalCGST.toFixed(2)),
                        totalSGST: parseFloat(totalSGST.toFixed(2)),
                        totalIGST: parseFloat(totalIGST.toFixed(2)),
                        placeOfSupply: buyerState,
                        stateCode: isIntrastate ? sellerStateCode : '',
                        paymentStatus: fullOrder.paymentStatus === 'Paid' ? 'Paid' : 'Unpaid',
                        paidAmount: fullOrder.paymentStatus === 'Paid' ? grandTotal : 0,
                        paymentReference: order.razorpayPaymentId || order.razorpayOrderId || fullOrder?.razorpayPaymentId || fullOrder?.razorpayOrderId || '',
                        invoiceType: isMarketplace ? 'marketplace_seller' : 'direct_product',
                        sellerId: primarySeller ? primarySeller._id : null,
                        businessName: isMarketplace ? (sellerProf.storeName || primarySeller.name) : (biz.accountHolderName || 'WATTORBIT ENERGY SOLUTIONS LLP'),
                        businessGST: isMarketplace ? sellerProf.gstin : (biz.gstNumber || '09AAFFW4253N1ZL'),
                        businessPAN: isMarketplace ? sellerProf.pan : (biz.panNumber || 'AAFFW4253N'),
                        businessAddress: isMarketplace ? (sellerProf.pickupAddress?.addressLine || 'Registered Seller Facility') : (biz.branchName || 'Shop No.3, INDAURABAG, BKT LUCKNOW - 226201'),
                        bankDetails: {
                            accountHolderName: isMarketplace ? (sellerProf.bankDetails?.beneficiaryName || sellerProf.storeName) : (biz.accountHolderName || 'WATTORBIT ENERGY SOLUTIONS LLP'),
                            accountNumber: isMarketplace ? sellerProf.bankDetails?.accountNumber : (biz.accountNumber || ''),
                            ifscCode: isMarketplace ? sellerProf.bankDetails?.ifscCode : (biz.ifscCode || ''),
                            bankName: isMarketplace ? sellerProf.bankDetails?.bankName : (biz.bankName || ''),
                            branchName: biz.branchName || '',
                            upiId: biz.upiId || ''
                        },
                        customerName: fullOrder.userId.name,
                        customerPhone: fullOrder.userId.phone,
                        customerEmail: fullOrder.userId.email,
                        customerAddress
                    };

                    // Execute Pre-Flight Compliance Verification & Set-off
                    const compliantInvoiceData = verifyAndEnrichInvoiceCompliance(invoicePayload, { isMarketplace });
                    const invoice = new Invoice(compliantInvoiceData);
                    await invoice.save();

                    // Generate PDF buffer and upload to Cloudinary
                    const pdfBuffer = await generateInvoicePDF(invoice, { buffer: true });
                    const tmpDir = path.join(__dirname, '..', 'uploads');
                    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
                    const tmpPath = path.join(tmpDir, `invoice-${invoice.invoiceId}.pdf`);
                    fs.writeFileSync(tmpPath, pdfBuffer);

                    const uploadResult = await uploadToCloudinary(tmpPath, 'wattorbit/invoices', 'raw');
                    fs.unlinkSync(tmpPath); // cleanup

                    if (uploadResult?.url) {
                        order.invoiceUrl = uploadResult.url;
                        invoice.invoiceUrl = uploadResult.url;
                        await order.save();
                        await invoice.save();
                    }

                    console.log(`[Auto-Invoice] Generated invoice ${generatedInvoiceId} for order ${order.orderId}`);
                    
                    // Auto-trigger Seller Settlement Calculation
                    try {
                        const axios = require('axios');
                        const SellerSettlement = require('../models/SellerSettlement');
                        const { round } = require('../utils/mathUtils');
                        
                        // Check if order has seller products and calculate settlement
                        for (const itm of (fullOrder.items || [])) {
                            if (itm.materialId) {
                                const mDoc = await Material.findById(itm.materialId).populate('sellerId');
                                if (mDoc && mDoc.sellerId) {
                                    const sId = mDoc.sellerId._id;
                                    const sExists = await SellerSettlement.findOne({ orderId: order._id, sellerId: sId });
                                    if (!sExists) {
                                        const sProfile = mDoc.sellerId.sellerProfile || {};
                                        const cRate = Number(sProfile.commissionRate || 10);
                                        const lineTaxable = round((itm.sellingPrice || 0) * (itm.quantity || 1));
                                        const lineGST = round((itm.sellingTaxAmount || 0) * (itm.quantity || 1));
                                        const lineGross = itm.totalLineAmount || (lineTaxable + lineGST);
                                        const comm = round((lineTaxable * cRate) / 100);
                                        const commTax = round(comm * 0.18);
                                        const tcs = round((lineTaxable * 1) / 100);
                                        const gw = round(lineGross * 0.02);
                                        const payout = round(lineGross - (comm + commTax + tcs + gw));

                                        const newStl = new SellerSettlement({
                                            settlementId: 'STL-' + Date.now().toString().slice(-6) + '-' + Math.floor(100 + Math.random() * 900),
                                            sellerId: sId,
                                            orderId: order._id,
                                            orderCode: order.orderId || ('ORD-' + String(order._id).slice(-6)),
                                            grossSaleAmount: lineGross,
                                            taxableSaleAmount: lineTaxable,
                                            productGSTAmount: lineGST,
                                            commissionRate: cRate,
                                            commissionAmount: comm,
                                            commissionGSTAmount: commTax,
                                            tcsRate: 1,
                                            tcsAmount: tcs,
                                            gatewayFeeAmount: gw,
                                            netPayoutAmount: payout,
                                            status: 'ready_for_payout',
                                            settlementDueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                                        });
                                        await newStl.save();
                                        console.log(`[Auto-Settlement] Created settlement ${newStl.settlementId} for seller ${sId}`);
                                    }
                                }
                            }
                        }
                    } catch (settleErr) {
                        console.error('[Auto-Settlement] Error generating settlement:', settleErr.message);
                    }
                }
            } catch (invoiceErr) {
                console.error('[Auto-Invoice] Error generating invoice:', invoiceErr);
                // Don't fail the status update if invoice generation fails
            }
        }

        // Notify user of status change via multi-channel notification engine (Push, SMS, Email)
        if (status) {
            const eventMap = {
                'Processing': 'ORDER_PROCESSING',
                'Dispatched': 'ORDER_DISPATCHED',
                'Out for Delivery': 'OUT_FOR_DELIVERY',
                'Delivered': 'ORDER_DELIVERED',
                'Cancelled': 'ORDER_CANCELLED'
            };
            const eventType = eventMap[status] || 'ORDER_STATUS_UPDATE';

            sendOrderLifecycleNotification(order, eventType, {
                partner: deliveryPartner || order.deliveryPartner,
                trackingId: trackingId || order.trackingId,
                partnerPhone: order.deliveryPartnerContact
            }).catch(e => console.error('[Order Lifecycle Notification] Status update error:', e.message));

            await sendUserNotification(
                order.userId,
                `Order ${status}!`,
                `Your order #${order.orderId} status has been updated to ${status}.`,
                { type: 'ORDER_STATUS_UPDATE', orderId: order._id.toString(), status }
            ).catch(console.error);

            const user = await User.findById(order.userId);
            if (user?.email) {
                let html = `<h2>Order Status Update</h2>
                            <p>Hello,</p>
                            <p>Your order <b>#${order.orderId}</b> is now <b>${status}</b>.</p>`;
                if (trackingId) {
                    html += `<p>Tracking ID: <b>${trackingId}</b></p>`;
                }
                if (deliveryPartner) {
                    html += `<p>Delivery Partner: <b>${deliveryPartner}</b></p>`;
                }
                if (status === 'Delivered' && order.invoiceUrl) {
                    html += `<p>Your invoice is ready: <a href="${order.invoiceUrl}">Download Invoice</a></p>`;
                }
                
                sendMail({
                    to: user.email,
                    subject: `Order Update #${order.orderId}: ${status}`,
                    html
                }).catch(console.error);
            }
        }

        res.json({ message: 'Order updated successfully', order });
    } catch (err) {
        res.status(500).json({ message: 'Error updating order', error: err.message });
    }
});

// POST: Regenerate invoice for an order
router.post('/:id/regenerate-invoice', verifyToken, async (req, res) => {
    try {
        const order = await getOrderByIdOrOrderId(req.params.id, ['userId', 'addressId']);
        if (!order) return res.status(404).json({ message: 'Order not found' });
        
        const existingInvoice = await Invoice.findOne({ orderRefId: order._id });
        let invoiceIdToUse;
        if (existingInvoice) {
            invoiceIdToUse = existingInvoice.invoiceId;
            await Invoice.findOneAndDelete({ orderRefId: order._id });
        } else {
            invoiceIdToUse = await generateInvoiceId();
        }
        
        const bizConfig = await Config.findOne({ key: 'bank_details' });
        const biz = bizConfig && bizConfig.value ? (typeof bizConfig.value === 'string' ? JSON.parse(bizConfig.value) : bizConfig.value) : {};

        let invoiceItems = [];
        let totalTaxable = 0, totalCGST = 0, totalSGST = 0, totalIGST = 0;
        
        const sellerStateCode = '09';
        const sellerState = 'Uttar Pradesh';
        const buyerState = order.addressId?.state || '';
        const isIntrastate = buyerState.toLowerCase().includes(sellerState.toLowerCase()) || 
                             buyerState.toLowerCase().includes('u.p') || 
                             buyerState.toLowerCase().includes('up') || 
                             !buyerState;

        order.items.forEach(item => {
            const qty = item.quantity || 1;
            const sp = item.sellingPrice || 0;
            const taxRate = item.taxRate || 18;
            
            const preTax = sp;
            const totalPreTax = preTax * qty;
            const totalTax = totalPreTax * (taxRate / 100);
            
            let cgst = 0, sgst = 0, igst = 0;
            if (isIntrastate) {
                cgst = totalTax / 2;
                sgst = totalTax / 2;
            } else {
                igst = totalTax;
            }

            invoiceItems.push({
                description: `${item.name} [${item.make || 'N/A'}]`,
                quantity: qty,
                unitPrice: preTax,
                taxableValue: totalPreTax,
                taxRate,
                cgstRate: isIntrastate ? taxRate / 2 : 0,
                cgstAmount: parseFloat(cgst.toFixed(2)),
                sgstRate: isIntrastate ? taxRate / 2 : 0,
                sgstAmount: parseFloat(sgst.toFixed(2)),
                igstRate: !isIntrastate ? taxRate : 0,
                igstAmount: parseFloat(igst.toFixed(2)),
                taxAmount: parseFloat(totalTax.toFixed(2)),
                total: parseFloat((sp * qty + totalTax).toFixed(2))
            });

            totalTaxable += totalPreTax;
            totalCGST += cgst;
            totalSGST += sgst;
            totalIGST += igst;
        });

        // Add Delivery Charge as an item if present
        if (order.deliveryCharge > 0) {
            const preTaxDel = parseFloat((order.deliveryCharge / 1.18).toFixed(2));
            const taxDel = order.deliveryCharge - preTaxDel;
            let cgst = 0, sgst = 0, igst = 0;
            if (isIntrastate) { cgst = taxDel/2; sgst = taxDel/2; } else { igst = taxDel; }
            
            invoiceItems.push({
                description: 'Delivery Charge', quantity: 1, unitPrice: preTaxDel, taxableValue: preTaxDel,
                taxRate: 18, cgstRate: isIntrastate ? 9 : 0, cgstAmount: parseFloat(cgst.toFixed(2)),
                sgstRate: isIntrastate ? 9 : 0, sgstAmount: parseFloat(sgst.toFixed(2)),
                igstRate: isIntrastate ? 0 : 18, igstAmount: parseFloat(igst.toFixed(2)),
                taxAmount: parseFloat(taxDel.toFixed(2)), total: order.deliveryCharge
            });
            totalTaxable += preTaxDel; totalCGST += cgst; totalSGST += sgst; totalIGST += igst;
        }

        // Add COD Handling if present
        if (order.paymentMethod === 'COD') {
            const codCharge = 20;
            const preTaxCod = parseFloat((codCharge / 1.18).toFixed(2));
            const taxCod = codCharge - preTaxCod;
            let cgst = 0, sgst = 0, igst = 0;
            if (isIntrastate) { cgst = taxCod/2; sgst = taxCod/2; } else { igst = taxCod; }
            
            invoiceItems.push({
                description: 'COD Handling Charge', quantity: 1, unitPrice: preTaxCod, taxableValue: preTaxCod,
                taxRate: 18, cgstRate: isIntrastate ? 9 : 0, cgstAmount: parseFloat(cgst.toFixed(2)),
                sgstRate: isIntrastate ? 9 : 0, sgstAmount: parseFloat(sgst.toFixed(2)),
                igstRate: isIntrastate ? 0 : 18, igstAmount: parseFloat(igst.toFixed(2)),
                taxAmount: parseFloat(taxCod.toFixed(2)), total: codCharge
            });
            totalTaxable += preTaxCod; totalCGST += cgst; totalSGST += sgst; totalIGST += igst;
        }

        const grandTotal = parseFloat((totalTaxable + totalCGST + totalSGST + totalIGST).toFixed(2));
        const amountWords = convertNumberToWords(grandTotal);
        const addr = order.addressId;
        const customerAddress = `${addr?.flatNo ? addr.flatNo + ', ' : ''}${addr?.building ? addr.building + ', ' : ''}${addr?.street || ''}, ${addr?.landmark ? addr.landmark + ', ' : ''}${addr?.city || ''}, ${addr?.state || ''} - ${addr?.pincode || ''}`;

        const invoice = new Invoice({
            invoiceId: invoiceIdToUse, orderRefId: order._id, userId: order.userId._id, invoiceDate: order.createdAt || new Date(),
            items: invoiceItems, subtotal: parseFloat(totalTaxable.toFixed(2)), taxAmount: parseFloat((totalCGST + totalSGST + totalIGST).toFixed(2)),
            discount: 0, totalAmount: grandTotal, amountInWords: amountWords, totalCGST: parseFloat(totalCGST.toFixed(2)),
            totalSGST: parseFloat(totalSGST.toFixed(2)), totalIGST: parseFloat(totalIGST.toFixed(2)), placeOfSupply: buyerState, stateCode: isIntrastate ? sellerStateCode : '',
            paymentStatus: order.paymentStatus === 'Paid' ? 'Paid' : 'Unpaid', 
            paidAmount: order.paymentStatus === 'Paid' ? grandTotal : 0,
            paymentReference: order.razorpayPaymentId || order.razorpayOrderId || '',
            businessName: biz.accountHolderName || 'WATTORBIT ENERGY SOLUTIONS LLP', businessGST: biz.gstNumber || '09AAFFW4253N1ZL', businessPAN: biz.panNumber || 'AAFFW4253N',
            businessAddress: biz.branchName || 'Shop No.3, INDAURABAG, BKT LUCKNOW - 226201',
            bankDetails: {
                accountHolderName: biz.accountHolderName || 'WATTORBIT ENERGY SOLUTIONS LLP', accountNumber: biz.accountNumber || '',
                ifscCode: biz.ifscCode || '', bankName: biz.bankName || '', branchName: biz.branchName || '',
                upiId: biz.upiId || ''
            },
            customerName: order.userId.name, customerPhone: order.userId.phone, customerEmail: order.userId.email, customerAddress
        });
        await invoice.save();

        order.invoiceUrl = 'system';
        await order.save();

        res.json({ message: 'Invoice regenerated successfully', order, invoice });
    } catch (err) {
        console.error('[Regenerate Invoice] Error:', err);
        res.status(500).json({ message: 'Error regenerating invoice', error: err.message });
    }
});

module.exports = router;
