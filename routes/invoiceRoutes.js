const express = require('express');
const router = express.Router();
const Invoice = require('../models/Invoice');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const Address = require('../models/Address');
const User = require('../models/User');
const Config = require('../models/Config');
const { generateInvoiceId } = require('../utils/idGenerator');
const { convertNumberToWords } = require('../utils/numberToWords');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const multer = require('multer');
const { uploadToCloudinary } = require('../utils/cloudinaryHelper');

const { verifyToken } = require('../middleware/authMiddleware');

const upload = multer({ dest: 'uploads/' });

// GET: Fetch the next auto-generated Invoice ID
router.get('/next-id', verifyToken, async (req, res) => {
    try {
        const nextId = await generateInvoiceId();
        res.json({ invoiceId: nextId });
    } catch (error) {
        console.error('Error fetching next invoice ID:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

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

        // Check access
        if (
            booking.userId._id.toString() !== req.user.id &&
            !['admin', 'employee', 'engineer'].includes(req.user.role) &&
            !(req.user.role === 'organisation' && booking.organisationId?.toString() === req.user.id)
        ) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Fetch Business & Bank Details (GST, etc.)
        const bankConfig = await Config.findOne({ key: 'bank_details' });
        const biz = bankConfig?.value || {};
        const sellerState = 'Uttar Pradesh'; // Base state for WattOrbit
        const sellerStateCode = '09';

        // Determine Tax Type (Intrastate vs Interstate)
        const buyerState = booking.addressId.state || '';
        const isIntrastate = buyerState.toLowerCase().includes(sellerState.toLowerCase()) || 
                             buyerState.toLowerCase().includes('u.p') || 
                             buyerState.toLowerCase().includes('up');

        // Get payment details
        const payment = await Payment.findOne({ bookingId });
        const invoiceId = await generateInvoiceId();

        // Build line items
        const invoiceItems = [];
        let totalTaxable = 0;
        let totalCGST = 0;
        let totalSGST = 0;
        let totalIGST = 0;

        const processItem = (item) => {
            const taxableValue = item.taxableValue;
            const rate = item.taxRate;
            let cgst = 0, sgst = 0, igst = 0;

            if (rate > 0) {
                if (isIntrastate) {
                    cgst = parseFloat((taxableValue * (rate / 2) / 100).toFixed(2));
                    sgst = parseFloat((taxableValue * (rate / 2) / 100).toFixed(2));
                } else {
                    igst = parseFloat((taxableValue * rate / 100).toFixed(2));
                }
            }

            return {
                ...item,
                cgstRate: isIntrastate ? rate / 2 : 0,
                cgstAmount: cgst,
                sgstRate: isIntrastate ? rate / 2 : 0,
                sgstAmount: sgst,
                igstRate: isIntrastate ? 0 : rate,
                igstAmount: igst,
                taxAmount: cgst + sgst + igst,
                total: taxableValue + cgst + sgst + igst
            };
        };

        // 1. Materials
        if (booking.materialsUsed && booking.materialsUsed.length > 0) {
            booking.materialsUsed.forEach(m => {
                const item = processItem({
                    description: `${m.name} (${m.make})`,
                    hsnSac: m.hsnCode || '',
                    quantity: m.quantity,
                    unitPrice: m.sellingPrice,
                    taxableValue: m.sellingPrice * m.quantity,
                    taxRate: m.sellingTaxRate || 0
                });
                invoiceItems.push(item);
                totalTaxable += item.taxableValue;
                totalCGST += item.cgstAmount;
                totalSGST += item.sgstAmount;
                totalIGST += item.igstAmount;
            });
        }

        // 2. Service (Tech Fee)
        const sacCode = booking.packageId?.sacCode || booking.serviceId?.sacCode || '998700';
        if (booking.technicianCharges > 0) {
            const item = processItem({
                description: `${booking.serviceId.name} - Technician Fee`,
                hsnSac: sacCode,
                quantity: 1,
                unitPrice: booking.technicianCharges,
                taxableValue: booking.technicianCharges,
                taxRate: 0
            });
            invoiceItems.push(item);
            totalTaxable += item.taxableValue;
        }

        // 3. Platform Fee
        if (booking.platformFees > 0) {
            const item = processItem({
                description: `${booking.serviceId.name} - Platform Fee`,
                hsnSac: sacCode,
                quantity: 1,
                unitPrice: booking.platformFees,
                taxableValue: booking.platformFees,
                taxRate: 18
            });
            invoiceItems.push(item);
            totalTaxable += item.taxableValue;
            totalCGST += item.cgstAmount;
            totalSGST += item.sgstAmount;
            totalIGST += item.igstAmount;
        }

        const grandTotal = parseFloat((totalTaxable + totalCGST + totalSGST + totalIGST - booking.discount).toFixed(2));
        const amountWords = convertNumberToWords(grandTotal);

        // Format address
        const addr = booking.addressId;
        const customerAddress = `${addr.flatNo ? addr.flatNo + ', ' : ''}${addr.building ? addr.building + ', ' : ''}${addr.street}, ${addr.landmark ? addr.landmark + ', ' : ''}${addr.city}, ${addr.state} - ${addr.pincode}`;

        const invoice = new Invoice({
            invoiceId,
            bookingId,
            userId: booking.userId._id,
            invoiceDate: new Date(),
            items: invoiceItems,
            subtotal: parseFloat(totalTaxable.toFixed(2)),
            taxAmount: parseFloat((totalCGST + totalSGST + totalIGST).toFixed(2)),
            discount: booking.discount,
            totalAmount: grandTotal,
            amountInWords: amountWords,
            totalCGST: parseFloat(totalCGST.toFixed(2)),
            totalSGST: parseFloat(totalSGST.toFixed(2)),
            totalIGST: parseFloat(totalIGST.toFixed(2)),
            placeOfSupply: buyerState,
            stateCode: isIntrastate ? sellerStateCode : '', // Simplified, could map all state codes
            paymentStatus: payment && payment.status === 'Paid' ? 'Paid' : 'Unpaid',
            paidAmount: payment && payment.status === 'Paid' ? payment.amount : 0,
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
            customerName: booking.userId.name,
            customerPhone: booking.userId.phone,
            customerEmail: booking.userId.email,
            customerAddress
        });

        await invoice.save();
        res.status(201).json({ message: 'Invoice generated successfully', invoice });
    } catch (err) {
        console.error('Error generating invoice:', err);
        res.status(500).json({ message: 'Failed to generate invoice' });
    }
});

// POST: Generate invoice for Material Order
router.post('/generate-order', verifyToken, async (req, res) => {
    try {
        const { orderId } = req.body; // This is the _id of the Order model

        if (!orderId) {
            return res.status(400).json({ message: 'Order ID required' });
        }

        // Check if invoice already exists
        const existingInvoice = await Invoice.findOne({ orderRefId: orderId });
        if (existingInvoice) {
            return res.status(400).json({
                message: 'Invoice already exists for this order',
                invoice: existingInvoice
            });
        }

        // Get order details
        const Order = require('../models/Order'); // ensure it's loaded
        const order = await Order.findById(orderId)
            .populate('userId')
            .populate('addressId');

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Check access
        if (
            order.userId._id.toString() !== req.user.id &&
            !['admin', 'employee', 'engineer'].includes(req.user.role)
        ) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Fetch Business & Bank Details (GST, etc.)
        const bankConfig = await Config.findOne({ key: 'bank_details' });
        const biz = bankConfig?.value || {};
        const sellerState = 'Uttar Pradesh'; 
        const sellerStateCode = '09';

        const buyerState = order.addressId.state || '';
        const isIntrastate = buyerState.toLowerCase().includes(sellerState.toLowerCase()) || 
                             buyerState.toLowerCase().includes('u.p') || 
                             buyerState.toLowerCase().includes('up');

        const generatedInvoiceId = await generateInvoiceId();

        const invoiceItems = [];
        let totalTaxable = 0;
        let totalCGST = 0;
        let totalSGST = 0;
        let totalIGST = 0;

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
                    description: `${m.name} (${m.make})`,
                    hsnSac: '', // Optional: fetch HSN from material model if needed
                    quantity: m.quantity,
                    unitPrice: m.sellingPrice,
                    taxableValue: taxableValue,
                    taxRate: rate,
                    cgstRate: isIntrastate ? rate / 2 : 0,
                    cgstAmount: cgst,
                    sgstRate: isIntrastate ? rate / 2 : 0,
                    sgstAmount: sgst,
                    igstRate: isIntrastate ? 0 : rate,
                    igstAmount: igst,
                    taxAmount: cgst + sgst + igst,
                    total: taxableValue + cgst + sgst + igst
                });
                totalTaxable += taxableValue;
                totalCGST += cgst;
                totalSGST += sgst;
                totalIGST += igst;
            });
        }

        let codChargeObj = null;
        if (order.codCharge > 0) {
            const taxRate = 18;
            const preTaxCod = parseFloat((order.codCharge / 1.18).toFixed(2));
            const codTax = order.codCharge - preTaxCod;
            
            let cgst = 0, sgst = 0, igst = 0;
            if (isIntrastate) {
                cgst = parseFloat((codTax / 2).toFixed(2));
                sgst = parseFloat((codTax / 2).toFixed(2));
            } else {
                igst = parseFloat(codTax.toFixed(2));
            }

            codChargeObj = {
                description: 'COD Handling Charge',
                hsnSac: '999999',
                quantity: 1,
                unitPrice: preTaxCod,
                taxableValue: preTaxCod,
                taxRate: taxRate,
                cgstRate: isIntrastate ? taxRate / 2 : 0,
                cgstAmount: cgst,
                sgstRate: isIntrastate ? taxRate / 2 : 0,
                sgstAmount: sgst,
                igstRate: isIntrastate ? 0 : taxRate,
                igstAmount: igst,
                taxAmount: cgst + sgst + igst,
                total: preTaxCod + cgst + sgst + igst
            };
            invoiceItems.push(codChargeObj);
            totalTaxable += preTaxCod;
            totalCGST += cgst;
            totalSGST += sgst;
            totalIGST += igst;
        }

        const grandTotal = parseFloat((totalTaxable + totalCGST + totalSGST + totalIGST).toFixed(2));
        const amountWords = convertNumberToWords(grandTotal);

        const addr = order.addressId;
        const customerAddress = `${addr.flatNo ? addr.flatNo + ', ' : ''}${addr.building ? addr.building + ', ' : ''}${addr.street}, ${addr.landmark ? addr.landmark + ', ' : ''}${addr.city}, ${addr.state} - ${addr.pincode}`;

        const invoice = new Invoice({
            invoiceId: generatedInvoiceId,
            orderRefId: orderId, // using a separate field for material orders
            userId: order.userId._id,
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
            paymentStatus: order.paymentStatus === 'Paid' ? 'Paid' : 'Unpaid',
            paidAmount: order.paymentStatus === 'Paid' ? grandTotal : 0,
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
            customerName: order.userId.name,
            customerPhone: order.userId.phone,
            customerEmail: order.userId.email,
            customerAddress
        });

        await invoice.save();
        res.status(201).json({ message: 'Invoice generated successfully', invoice });
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

        // Check access: user themselves, admin, employee, engineer, or their organisation
        if (
            invoice.userId._id.toString() !== req.user.id &&
            !['admin', 'employee', 'engineer'].includes(req.user.role) &&
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

        // Check access: user themselves, admin, employee, engineer, or their organisation
        if (
            invoice.userId._id.toString() !== req.user.id &&
            !['admin', 'employee', 'engineer'].includes(req.user.role) &&
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

// GET: Get invoice by order ID
router.get('/order/:orderId', verifyToken, async (req, res) => {
    try {
        const invoice = await Invoice.findOne({ orderRefId: req.params.orderId })
            .populate('userId', 'name phone email');

        if (!invoice) {
            return res.status(404).json({ message: 'Invoice not found for this order' });
        }

        if (
            invoice.userId._id.toString() !== req.user.id &&
            !['admin', 'employee'].includes(req.user.role)
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

        // Check access: user themselves, admin, employee, engineer, or their organisation
        if (
            invoice.userId._id.toString() !== req.user.id &&
            !['admin', 'employee', 'engineer'].includes(req.user.role) &&
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

// POST: Save manual invoice and upload to Cloudinary
router.post('/manual', verifyToken, upload.single('invoicePdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Invoice PDF file is required' });
        }

        const invoiceData = JSON.parse(req.body.invoiceData);
        
        // Upload PDF to Cloudinary
        const uploadResult = await uploadToCloudinary(req.file.path, 'wattorbit/invoices', 'raw');
        
        // Remove temp file
        fs.unlinkSync(req.file.path);

        // Save to DB
        const invoice = new Invoice({
            invoiceId: invoiceData.invoiceNo,
            isManual: true,
            invoiceUrl: uploadResult.url,
            customerName: invoiceData.customerName || 'Walk-in Customer',
            customerPhone: invoiceData.customerPhone,
            customerEmail: invoiceData.customerEmail,
            customerAddress: invoiceData.customerAddress,
            customerGST: invoiceData.customerGST,
            subtotal: invoiceData.subtotal,
            taxAmount: invoiceData.taxAmount,
            totalAmount: invoiceData.totalAmount,
            discount: invoiceData.discount,
            items: invoiceData.items || [],
            invoiceDate: invoiceData.invoiceDate,
            dueDate: invoiceData.dueDate,
            placeOfSupply: invoiceData.placeOfSupply
        });

        await invoice.save();

        res.status(201).json({ 
            message: 'Manual invoice saved successfully', 
            invoiceId: invoice.invoiceId,
            url: uploadResult.url
        });
    } catch (error) {
        console.error('Error saving manual invoice:', error);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ message: 'Error saving manual invoice', error: error.message });
    }
});
