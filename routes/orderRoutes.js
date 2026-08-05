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
const Config = require('../models/Config');
const Invoice = require('../models/Invoice');
const { generateInvoiceId } = require('../utils/idGenerator');
const { convertNumberToWords } = require('../utils/numberToWords');
const { generateInvoicePDF } = require('../utils/invoicePDFGenerator');
const { uploadToCloudinary } = require('../utils/cloudinaryHelper');
const { createShipment, trackShipment, cancelShipment } = require('../services/delhiveryService');
const LogisticsConfig = require('../models/LogisticsConfig');

const fs = require('fs');
const path = require('path');

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// POST: Create Pending Order (Razorpay ID Generation)
router.post('/create', verifyToken, async (req, res) => {
    try {
        let { items, addressId, notes, paymentMethod = 'Online', deliveryFee = 0, couponDiscount = 0 } = req.body; // items: [{ id, quantity }]
        deliveryFee = Number(deliveryFee) || 0;
        couponDiscount = Number(couponDiscount) || 0;
        
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

                    const invoice = new Invoice({
                        invoiceId: generatedInvoiceId,
                        orderRefId: order._id,
                        userId: fullOrder.userId._id,
                        invoiceDate: new Date(),
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
                        businessName: biz.accountHolderName || 'WATTORBIT ENERGY SOLUTIONS LLP',
                        businessGST: biz.gstNumber || '09AAFFW4253N1ZL',
                        businessPAN: biz.panNumber || 'AAFFW4253N',
                        businessAddress: biz.branchName || 'Shop No.3, INDAURABAG, BKT LUCKNOW - 226201',
                        bankDetails: {
                            accountHolderName: biz.accountHolderName || 'WATTORBIT ENERGY SOLUTIONS LLP',
                            accountNumber: biz.accountNumber || '',
                            ifscCode: biz.ifscCode || '',
                            bankName: biz.bankName || '',
                            branchName: biz.branchName || ''
                        },
                        customerName: fullOrder.userId.name,
                        customerPhone: fullOrder.userId.phone,
                        customerEmail: fullOrder.userId.email,
                        customerAddress
                    });
                    await invoice.save();

                    // Generate PDF buffer and upload to Cloudinary
                    const pdfBuffer = await generateInvoicePDF(invoice, { buffer: true });
                    const tmpDir = path.join(__dirname, '..', 'uploads');
                    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
                    const tmpPath = path.join(tmpDir, `invoice-${invoice.invoiceId}.pdf`);
                    fs.writeFileSync(tmpPath, pdfBuffer);

                    const uploadResult = await uploadToCloudinary(tmpPath, 'wattorbit/invoices', 'image');
                    fs.unlinkSync(tmpPath); // cleanup

                    if (uploadResult?.url) {
                        order.invoiceUrl = uploadResult.url;
                        invoice.invoiceUrl = uploadResult.url;
                        await order.save();
                        await invoice.save();
                    }

                    console.log(`[Auto-Invoice] Generated invoice ${generatedInvoiceId} for order ${order.orderId}`);
                }
            } catch (invoiceErr) {
                console.error('[Auto-Invoice] Error generating invoice:', invoiceErr);
                // Don't fail the status update if invoice generation fails
            }
        }

        // Notify user of status change
        if (status) {
            await sendUserNotification(
                order.userId,
                `Order ${status}!`,
                `Your order #${order.orderId} status has been updated to ${status}.`,
                { type: 'ORDER_STATUS_UPDATE', orderId: order._id.toString(), status }
            );

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

// GET: Check Pincode Serviceability
router.get('/check-pincode', async (req, res) => {
    try {
        const { pincode } = req.query;
        if (!pincode || pincode.length !== 6 || !/^\d{6}$/.test(pincode)) {
            return res.status(400).json({ available: false, message: 'Invalid PIN code. Must be a 6-digit number.' });
        }

        const config = await Config.findOne({ key: 'serviceable_pincodes' });
        if (!config || !config.value) {
            return res.json({ available: false, message: 'Delivery service is currently unavailable.' });
        }

        let pincodeList = [];
        try {
            pincodeList = typeof config.value === 'string' ? JSON.parse(config.value) : config.value;
        } catch (e) {
            // Fallback for comma-separated old format
            pincodeList = config.value.split(',').map(p => ({ code: p.trim(), isActive: true }));
        }

        const match = pincodeList.find(p => p.code === pincode && p.isActive !== false);
        if (match) {
            return res.json({ available: true, message: `Delivery available to ${match.desc || pincode}` });
        }
        return res.json({ available: false, message: 'Delivery is not available to this PIN code yet.' });
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
        const order = await Order.findById(req.params.id).populate('addressId').populate('userId');
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
                    await sendUserNotification(
                        order.userId._id,
                        'Order Dispatched!',
                        `Your order #${order.orderId} has been dispatched via Delhivery. AWB: ${result.awb}`,
                        { type: 'ORDER_DISPATCHED', orderId: order._id.toString() }
                    );

                    return res.json({ message: 'Shipment booked on Delhivery', order, awb: result.awb });
                } else {
                    return res.status(400).json({ message: result.message || 'Failed to book Delhivery' });
                }
            } catch (apiError) {
                return res.status(500).json({ message: apiError.message });
            }
        }
        else {
            return res.status(400).json({ message: 'Invalid delivery type' });
        }
    } catch (err) {
        console.error('[Assign Delivery] Error:', err);
        res.status(500).json({ message: 'Error assigning delivery', error: err.message });
    }
});

// GET: Track Order
router.get('/:id/track', verifyToken, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
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

// POST: Force Regenerate Invoice for Delivered Order
router.post('/:id/regenerate-invoice', verifyToken, async (req, res) => {
    try {
        if (!['admin', 'employee'].includes(req.user.role)) return res.status(403).json({ message: 'Unauthorized' });
        
        const order = await Order.findOne({ orderId: req.params.id }).populate('userId').populate('addressId');
        if (!order) return res.status(404).json({ message: 'Order not found' });
        
        if (order.status !== 'Delivered') {
            return res.status(400).json({ message: 'Order must be delivered to generate invoice' });
        }

        const bankConfig = await Config.findOne({ key: 'bank_details' });
        const biz = bankConfig?.value || {};
        const sellerState = 'Uttar Pradesh';
        const sellerStateCode = '09';
        const buyerState = order.addressId?.state || '';
        const isIntrastate = buyerState.toLowerCase().includes(sellerState.toLowerCase()) ||
                             buyerState.toLowerCase().includes('u.p') ||
                             buyerState.toLowerCase().includes('up');

        const existingInvoice = await Invoice.findOne({ orderRefId: order._id });
        const invoiceIdToUse = existingInvoice ? existingInvoice.invoiceId : await generateInvoiceId();
        
        if (existingInvoice) {
            await Invoice.deleteOne({ _id: existingInvoice._id });
        }

        const invoiceItems = [];
        let totalTaxable = 0, totalCGST = 0, totalSGST = 0, totalIGST = 0;

        if (order.items && order.items.length > 0) {
            order.items.forEach(m => {
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
                    description: `${m.name} (${m.make})`, hsnSac: '', quantity: m.quantity, unitPrice: m.sellingPrice,
                    taxableValue, taxRate: rate, cgstRate: isIntrastate ? rate / 2 : 0, cgstAmount: cgst,
                    sgstRate: isIntrastate ? rate / 2 : 0, sgstAmount: sgst, igstRate: isIntrastate ? 0 : rate, igstAmount: igst,
                    taxAmount: cgst + sgst + igst, total: taxableValue + cgst + sgst + igst
                });
                totalTaxable += taxableValue; totalCGST += cgst; totalSGST += sgst; totalIGST += igst;
            });
        }

        if (order.codCharge > 0) {
            const preTaxCod = parseFloat((order.codCharge / 1.18).toFixed(2));
            const codTax = order.codCharge - preTaxCod;
            let cgst = 0, sgst = 0, igst = 0;
            if (isIntrastate) { cgst = parseFloat((codTax / 2).toFixed(2)); sgst = parseFloat((codTax / 2).toFixed(2)); }
            else { igst = parseFloat(codTax.toFixed(2)); }
            invoiceItems.push({
                description: 'COD Handling Charge', hsnSac: '999999', quantity: 1,
                unitPrice: preTaxCod, taxableValue: preTaxCod, taxRate: 18,
                cgstRate: isIntrastate ? 9 : 0, cgstAmount: cgst, sgstRate: isIntrastate ? 9 : 0, sgstAmount: sgst,
                igstRate: isIntrastate ? 0 : 18, igstAmount: igst, taxAmount: cgst + sgst + igst, total: preTaxCod + cgst + sgst + igst
            });
            totalTaxable += preTaxCod; totalCGST += cgst; totalSGST += sgst; totalIGST += igst;
        }

        const grandTotal = parseFloat((totalTaxable + totalCGST + totalSGST + totalIGST).toFixed(2));
        const amountWords = convertNumberToWords(grandTotal);
        const addr = order.addressId;
        const customerAddress = `${addr?.flatNo ? addr.flatNo + ', ' : ''}${addr?.building ? addr.building + ', ' : ''}${addr?.street || ''}, ${addr?.landmark ? addr.landmark + ', ' : ''}${addr?.city || ''}, ${addr?.state || ''} - ${addr?.pincode || ''}`;

        const invoice = new Invoice({
            invoiceId: invoiceIdToUse, orderRefId: order._id, userId: order.userId._id, invoiceDate: new Date(),
            items: invoiceItems, subtotal: parseFloat(totalTaxable.toFixed(2)), taxAmount: parseFloat((totalCGST + totalSGST + totalIGST).toFixed(2)),
            discount: 0, totalAmount: grandTotal, amountInWords: amountWords, totalCGST: parseFloat(totalCGST.toFixed(2)),
            totalSGST: parseFloat(totalSGST.toFixed(2)), totalIGST: parseFloat(totalIGST.toFixed(2)), placeOfSupply: buyerState, stateCode: isIntrastate ? sellerStateCode : '',
            paymentStatus: order.paymentStatus === 'Paid' ? 'Paid' : 'Unpaid', paidAmount: order.paymentStatus === 'Paid' ? grandTotal : 0,
            businessName: biz.accountHolderName || 'WATTORBIT ENERGY SOLUTIONS LLP', businessGST: biz.gstNumber || '09AAFFW4253N1ZL', businessPAN: biz.panNumber || 'AAFFW4253N',
            businessAddress: biz.branchName || 'Shop No.3, INDAURABAG, BKT LUCKNOW - 226201',
            bankDetails: {
                accountHolderName: biz.accountHolderName || 'WATTORBIT ENERGY SOLUTIONS LLP', accountNumber: biz.accountNumber || '',
                ifscCode: biz.ifscCode || '', bankName: biz.bankName || '', branchName: biz.branchName || ''
            },
            customerName: order.userId.name, customerPhone: order.userId.phone, customerEmail: order.userId.email, customerAddress
        });
        await invoice.save();

        const pdfBuffer = await generateInvoicePDF(invoice, { buffer: true });
        const tmpDir = path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        const tmpPath = path.join(tmpDir, `invoice-${invoice.invoiceId}.pdf`);
        fs.writeFileSync(tmpPath, pdfBuffer);

        const uploadResult = await uploadToCloudinary(tmpPath, 'wattorbit/invoices', 'image');
        fs.unlinkSync(tmpPath);

        if (uploadResult?.url) {
            order.invoiceUrl = uploadResult.url;
            invoice.invoiceUrl = uploadResult.url;
            await order.save();
            await invoice.save();
        }

        res.json({ message: 'Invoice regenerated successfully', order });
    } catch (err) {
        console.error('[Regenerate Invoice] Error:', err);
        res.status(500).json({ message: 'Error regenerating invoice', error: err.message });
    }
});

module.exports = router;
