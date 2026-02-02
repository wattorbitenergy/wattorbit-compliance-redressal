const express = require('express');
const router = express.Router();
const Invoice = require('../models/Invoice');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const Address = require('../models/Address');
const User = require('../models/User');
const { generateInvoiceId } = require('../utils/idGenerator');
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

// POST: Generate invoice for booking (auto-triggered or manual)
router.post('/generate', verifyToken, async (req, res) => {
    try {
        const { bookingId } = req.body;

        if (!bookingId) {
            return res.status(400).json({ message: 'Booking ID required' });
        }

        // Check if invoice already exists
        const existingInvoice = await Invoice.findOne({ bookingId });
        if (existingInvoice) {
            return res.status(400).json({
                message: 'Invoice already exists for this booking',
                invoice: existingInvoice
            });
        }

        // Get booking details
        const booking = await Booking.findById(bookingId)
            .populate('userId')
            .populate('serviceId')
            .populate('packageId')
            .populate('addressId');

        if (!booking) {
            return res.status(404).json({ message: 'Booking not found' });
        }

        // Check access: user themselves, admin, or their organisation
        if (
            booking.userId._id.toString() !== req.user.id &&
            req.user.role !== 'admin' &&
            !(req.user.role === 'organisation' && booking.organisationId?.toString() === req.user.id)
        ) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Get payment details
        const payment = await Payment.findOne({ bookingId });

        const invoiceId = await generateInvoiceId();

        // Build line items
        const items = [{
            description: `${booking.serviceId.name} - ${booking.packageId.name}`,
            quantity: 1,
            unitPrice: booking.basePrice,
            total: booking.basePrice
        }];

        // Format address
        const addr = booking.addressId;
        const customerAddress = `${addr.flatNo ? addr.flatNo + ', ' : ''}${addr.building ? addr.building + ', ' : ''}${addr.street}, ${addr.landmark ? addr.landmark + ', ' : ''}${addr.city}, ${addr.state} - ${addr.pincode}`;

        const invoice = new Invoice({
            invoiceId,
            bookingId,
            userId: booking.userId._id,
            invoiceDate: new Date(),
            dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
            items,
            subtotal: booking.basePrice,
            taxRate: 18,
            taxAmount: booking.taxes,
            discount: booking.discount,
            totalAmount: booking.totalAmount,
            paymentStatus: payment && payment.status === 'Paid' ? 'Paid' : 'Unpaid',
            paidAmount: payment && payment.status === 'Paid' ? payment.amount : 0,
            customerName: booking.userId.name,
            customerPhone: booking.userId.phone,
            customerEmail: booking.userId.email,
            customerAddress
        });

        await invoice.save();

        res.status(201).json({
            message: 'Invoice generated successfully',
            invoice
        });
    } catch (err) {
        console.error('Error generating invoice:', err);
        res.status(500).json({ message: 'Failed to generate invoice' });
    }
});

// GET: Get invoice details
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.id)
            .populate('bookingId')
            .populate('userId', 'name phone email');

        if (!invoice) {
            return res.status(404).json({ message: 'Invoice not found' });
        }

        // Check access: user themselves, admin, or their organisation
        if (
            invoice.userId._id.toString() !== req.user.id &&
            req.user.role !== 'admin' &&
            !(req.user.role === 'organisation' && invoice.bookingId?.organisationId?.toString() === req.user.id)
        ) {
            return res.status(403).json({ message: 'Access denied' });
        }

        res.json(invoice);
    } catch (err) {
        console.error('Error fetching invoice:', err);
        res.status(500).json({ message: 'Failed to fetch invoice' });
    }
});

// GET: Get invoice by booking ID
router.get('/booking/:bookingId', verifyToken, async (req, res) => {
    try {
        const invoice = await Invoice.findOne({ bookingId: req.params.bookingId })
            .populate('bookingId')
            .populate('userId', 'name phone email');

        if (!invoice) {
            return res.status(404).json({ message: 'Invoice not found for this booking' });
        }

        // Check access: user themselves, admin, or their organisation
        if (
            invoice.userId._id.toString() !== req.user.id &&
            req.user.role !== 'admin' &&
            !(req.user.role === 'organisation' && invoice.bookingId?.organisationId?.toString() === req.user.id)
        ) {
            return res.status(403).json({ message: 'Access denied' });
        }

        res.json(invoice);
    } catch (err) {
        console.error('Error fetching invoice:', err);
        res.status(500).json({ message: 'Failed to fetch invoice' });
    }
});

// GET: Get user's invoices
router.get('/user/my-invoices', verifyToken, async (req, res) => {
    try {
        const invoices = await Invoice.find({ userId: req.user.id })
            .populate('bookingId', 'bookingId scheduledDate status')
            .sort({ invoiceDate: -1 });

        res.json(invoices);
    } catch (err) {
        console.error('Error fetching user invoices:', err);
        res.status(500).json({ message: 'Failed to fetch invoices' });
    }
});

// GET: Download invoice as PDF
router.get('/:id/download', verifyToken, async (req, res) => {
    try {
        const PDFDocument = require('pdfkit');
        const fs = require('fs');
        const path = require('path');

        const invoice = await Invoice.findById(req.params.id)
            .populate('bookingId')
            .populate('userId', 'name phone email');

        if (!invoice) {
            return res.status(404).json({ message: 'Invoice not found' });
        }

        // Check access: user themselves, admin, or their organisation
        if (
            invoice.userId._id.toString() !== req.user.id &&
            req.user.role !== 'admin' &&
            !(req.user.role === 'organisation' && invoice.bookingId?.organisationId?.toString() === req.user.id)
        ) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Create PDF
        const doc = new PDFDocument({ margin: 50 });

        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoice.invoiceId}.pdf`);

        doc.pipe(res);

        // Logo
        const logoPath = path.join(__dirname, '../assets/logo.png');
        if (fs.existsSync(logoPath)) {
            doc.image(logoPath, 50, 45, { width: 50 });
        }

        // Header
        doc.fontSize(20).text('INVOICE', { align: 'right' });
        doc.moveDown();

        doc.fontSize(10).font('Helvetica-Bold').text('WATTORBIT ENERGY SOLUTIONS LLP', { align: 'right' });
        doc.font('Helvetica').text('Shop No.3, INDAURABAG', { align: 'right' });
        doc.text('BAKSHI KA TALAB LUCKNOW - 226202', { align: 'right' });
        doc.text('support@wattorbit.com', { align: 'right' });
        doc.moveDown();

        // Invoice Details
        doc.font('Helvetica');
        doc.text(`Invoice ID: ${invoice.invoiceId}`, 50, 150);
        doc.text(`Date: ${new Date(invoice.invoiceDate).toLocaleDateString()}`, 50, 165);
        doc.text(`Due Date: ${new Date(invoice.dueDate).toLocaleDateString()}`, 50, 180);

        doc.text(`Bill To:`, 300, 150);
        doc.font('Helvetica-Bold').text(invoice.customerName, 300, 165);
        doc.font('Helvetica').text(invoice.customerPhone, 300, 180);
        doc.text(invoice.customerEmail, 300, 195);
        doc.moveDown();

        // Address
        doc.text(invoice.customerAddress, 300, 210, { width: 250 });

        doc.moveDown();
        doc.moveDown();

        // Table Header
        const tableTop = 300;
        doc.font('Helvetica-Bold');
        doc.text('Description', 50, tableTop);
        doc.text('Quantity', 280, tableTop, { width: 90, align: 'right' });
        doc.text('Unit Price', 370, tableTop, { width: 90, align: 'right' });
        doc.text('Total', 460, tableTop, { width: 90, align: 'right' });
        doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

        // Items
        doc.font('Helvetica');
        let y = tableTop + 25;

        invoice.items.forEach(item => {
            doc.text(item.description, 50, y);
            doc.text(item.quantity, 280, y, { width: 90, align: 'right' });
            doc.text(`₹${item.unitPrice}`, 370, y, { width: 90, align: 'right' });
            doc.text(`₹${item.total}`, 460, y, { width: 90, align: 'right' });
            y += 20;
        });

        doc.moveTo(50, y).lineTo(550, y).stroke();
        y += 10;

        // Totals
        const subtotalY = y + 10;
        doc.text('Subtotal:', 370, subtotalY, { width: 90, align: 'right' });
        doc.text(`₹${invoice.subtotal}`, 460, subtotalY, { width: 90, align: 'right' });

        const taxY = subtotalY + 20;
        doc.text(`Tax (${invoice.taxRate}%):`, 370, taxY, { width: 90, align: 'right' });
        doc.text(`₹${invoice.taxAmount.toFixed(2)}`, 460, taxY, { width: 90, align: 'right' });

        if (invoice.discount > 0) {
            const discountY = taxY + 20;
            doc.text('Discount:', 370, discountY, { width: 90, align: 'right' });
            doc.text(`-₹${invoice.discount}`, 460, discountY, { width: 90, align: 'right' });
            y = discountY;
        } else {
            y = taxY;
        }

        const totalY = y + 25;
        doc.font('Helvetica-Bold').fontSize(14);
        doc.text('Total:', 370, totalY, { width: 90, align: 'right' });
        doc.text(`₹${invoice.totalAmount.toFixed(2)}`, 460, totalY, { width: 90, align: 'right' });

        // Footer
        doc.fontSize(10).font('Helvetica');
        doc.text('Payment Status:', 50, totalY);
        if (invoice.paymentStatus === 'Paid') {
            doc.fillColor('green').text('PAID', 130, totalY);
        } else {
            doc.fillColor('red').text('UNPAID', 130, totalY);
        }

        // Terms and Conditions
        doc.fillColor('black');
        doc.moveDown(4);
        doc.font('Helvetica-Bold').text('Terms & Conditions:', 50);
        doc.font('Helvetica').fontSize(9);
        doc.text('1. This is an electronically generated invoice and does not require a physical signature.');
        doc.text('2. All disputes are subject to Lucknow jurisdiction.');

        doc.moveDown(2);
        doc.fontSize(10).text('Thank you for choosing WattOrbit!', { align: 'center' });

        doc.end();

    } catch (err) {
        console.error('Error downloading invoice:', err);
        res.status(500).json({ message: 'Failed to download invoice' });
    }
});

module.exports = router;
