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
// Verify token middleware
const verifyToken = (req, res, next) => {
    let token;

    // Check header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    }
    // Check query param (for downloads/window.open)
    else if (req.query.token) {
        token = req.query.token;
    }

    if (!token) {
        return res.status(401).json({ message: 'Authorization header missing or invalid' });
    }

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

        // Build line items split into components
        const items = [
            {
                description: `${booking.serviceId.name} - ${booking.packageId.name} (Technician Fees)`,
                quantity: 1,
                unitPrice: booking.technicianCharges,
                total: booking.technicianCharges
            },
            {
                description: `${booking.serviceId.name} - ${booking.packageId.name} (Platform Fees)`,
                quantity: 1,
                unitPrice: booking.platformFees,
                total: booking.platformFees
            }
        ];

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
        const { generateInvoicePDF } = require('../utils/invoicePDFGenerator');

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
        const doc = await generateInvoicePDF(invoice);

        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoice.invoiceId}.pdf`);

        doc.pipe(res);
    } catch (err) {
        console.error('Error downloading invoice:', err);
        res.status(500).json({ message: 'Failed to download invoice' });
    }
});

module.exports = router;
