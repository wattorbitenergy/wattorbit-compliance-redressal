const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Generate Invoice PDF and return it as a stream or buffer
 * @param {Object} invoice - Invoice object with populated booking and user
 * @param {Object} options - Options like { buffer: true }
 * @returns {Promise<PDFDocument|Buffer>}
 */
const generateInvoicePDF = (invoice, options = {}) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50 });

            if (options.buffer) {
                const buffers = [];
                doc.on('data', buffers.push.bind(buffers));
                doc.on('end', () => {
                    resolve(Buffer.concat(buffers));
                });
            } else {
                resolve(doc);
            }

            // Logo
            const logoPath = path.join(__dirname, '../assets/logo.jpg');
            if (fs.existsSync(logoPath)) {
                doc.image(logoPath, 50, 45, { width: 50 });
            }

            // Header
            doc.fontSize(20).text('INVOICE', { align: 'right' });
            doc.moveDown();

            doc.fontSize(10).font('Helvetica-Bold').text('WATTORBIT ENERGY SOLUTIONS LLP', { align: 'right' });
            doc.font('Helvetica').text('Shop No.3, INDAURABAG', { align: 'right' });
            doc.text('BAKSHI KA TALAB LUCKNOW - 226202', { align: 'right' });
            doc.text('support@wattorbit.in', { align: 'right' });
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
            doc.text(`GST (18% on PF):`, 370, taxY, { width: 90, align: 'right' });
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
            reject(err);
        }
    });
};

module.exports = { generateInvoicePDF };
