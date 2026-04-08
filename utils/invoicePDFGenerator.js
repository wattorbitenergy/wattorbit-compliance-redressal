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
            const doc = new PDFDocument({
                margin: 35,
                size: 'A4',
                info: {
                    Title: `Tax Invoice - ${invoice.invoiceId}`,
                    Author: 'WattOrbit Energy Solutions LLP'
                }
            });

            if (options.buffer) {
                const buffers = [];
                doc.on('data', buffers.push.bind(buffers));
                doc.on('end', () => {
                    resolve(Buffer.concat(buffers));
                });
            } else {
                resolve(doc);
            }

            const primaryColor = '#1e3a8a'; // Navy Blue
            const secondaryColor = '#4b5563'; // Slate Gray

            // Logo
            const logoPath = path.join(__dirname, '../assets/logo.jpg');
            if (fs.existsSync(logoPath)) {
                doc.image(logoPath, 50, 35, { width: 50 });
            }

            // Header - Business Identity
            doc.fontSize(24).font('Helvetica-Bold').fillColor(primaryColor).text('INVOICE', { align: 'right' });
            doc.moveDown(0.2);

            doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text(invoice.businessName || 'WATTORBIT ENERGY SOLUTIONS LLP', { align: 'right' });
            doc.fontSize(9).font('Helvetica').fillColor(secondaryColor);
            doc.text('Shop No.3, INDAURABAG', { align: 'right' });
            doc.text('BAKSHI KA TALAB LUCKNOW - 226201', { align: 'right' }); // Updated Pincode
            doc.text('support@wattorbit.in', { align: 'right' });

            if (invoice.businessGST) {
                doc.font('Helvetica-Bold').fillColor(primaryColor).text(`GST: ${invoice.businessGST}`, { align: 'right' });
            }

            doc.moveDown(1.2);

            // Divider Line
            doc.lineWidth(1).strokeColor('#e5e7eb').moveTo(50, 115).lineTo(545, 115).stroke();

            // Invoice Details Column
            doc.fillColor('#000000');
            doc.fontSize(10).font('Helvetica-Bold').text('INVOICE DETAILS', 50, 125);
            doc.fontSize(9).font('Helvetica').fillColor(secondaryColor);
            doc.text(`Invoice ID:`, 50, 145);
            doc.text(`Date:`, 50, 157);
            doc.text(`Ref No.:`, 50, 169); // Ref No for Booking ID

            doc.fillColor('#000000').font('Helvetica-Bold');
            doc.text(invoice.invoiceId, 110, 145);

            // Format date as dd/mm/yyyy
            const dateObj = new Date(invoice.invoiceDate);
            const day = String(dateObj.getDate()).padStart(2, '0');
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const year = dateObj.getFullYear();
            const formattedDate = `${day}/${month}/${year}`;

            doc.text(formattedDate, 110, 157);
            doc.text(invoice.bookingId?.bookingId || 'N/A', 110, 169);

            // Bill To Column
            doc.fontSize(10).font('Helvetica-Bold').text('BILL TO', 300, 125);
            doc.fontSize(9).font('Helvetica').fillColor(secondaryColor);
            doc.fillColor('#000000').font('Helvetica-Bold').text(invoice.customerName, 300, 145);
            doc.font('Helvetica').fillColor(secondaryColor).text(invoice.customerPhone, 300, 157);
            doc.text(invoice.customerEmail, 300, 169);
            doc.text(invoice.customerAddress, 300, 181, { width: 245 });

            doc.moveDown(1.5);

            // Table Header Styling
            const tableTop = 230;
            doc.rect(50, tableTop - 5, 495, 25).fill(primaryColor);
            doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10);
            doc.text('Description', 60, tableTop);
            doc.text('Quantity', 280, tableTop, { width: 90, align: 'right' });
            doc.text('Unit Price', 370, tableTop, { width: 90, align: 'right' });
            doc.text('Total', 460, tableTop, { width: 80, align: 'right' });

            // Items List
            doc.fillColor('#000000').font('Helvetica').fontSize(9);
            let y = tableTop + 25;

            invoice.items.forEach((item, index) => {
                // Zebra stripes
                if (index % 2 === 1) {
                    doc.rect(50, y - 4, 495, 16).fill('#f9fafb');
                    doc.fillColor('#000000');
                } else {
                    doc.fillColor('#000000');
                }

                doc.text(item.description, 60, y);
                doc.text(item.quantity, 280, y, { width: 90, align: 'right' });
                doc.text(`₹${item.unitPrice}`, 370, y, { width: 90, align: 'right' });
                doc.text(`₹${item.total}`, 460, y, { width: 80, align: 'right' });
                y += 16;
            });

            // Divider Line after items
            doc.lineWidth(0.5).strokeColor('#e5e7eb').moveTo(50, y).lineTo(545, y).stroke();
            y += 10;

            // Calculations Section
            const calculationX = 370;
            const valueX = 460;
            const rowHeight = 15;

            doc.fillColor(secondaryColor).font('Helvetica');
            doc.text('Subtotal:', calculationX, y, { width: 90, align: 'right' });
            doc.fillColor('#000000').text(`₹${invoice.subtotal}`, valueX, y, { width: 80, align: 'right' });
            y += rowHeight;

            doc.fillColor(secondaryColor).text(`GST (18% on PF):`, calculationX, y, { width: 90, align: 'right' });
            doc.fillColor('#000000').text(`₹${invoice.taxAmount.toFixed(2)}`, valueX, y, { width: 80, align: 'right' });
            y += rowHeight;

            if (invoice.discount > 0) {
                doc.fillColor(secondaryColor).text('Discount:', calculationX, y, { width: 90, align: 'right' });
                doc.fillColor('#ef4444').text(`-₹${invoice.discount}`, valueX, y, { width: 80, align: 'right' });
                y += rowHeight;
            }

            y += 3;
            // Total Box
            doc.rect(360, y - 4, 185, 26).fill(primaryColor);
            doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11);
            doc.text('Total:', calculationX, y + 4, { width: 90, align: 'right' });
            doc.text(`₹${invoice.totalAmount.toFixed(2)}`, valueX, y + 4, { width: 80, align: 'right' });

            y += 35;

            // Payment Status Section
            doc.fillColor('#000000').font('Helvetica-Bold').fontSize(10);
            doc.text('Payment Status:', 50, y);

            const method = invoice.bookingId?.paymentMethod || 'CASH';
            const statusText = invoice.paymentStatus === 'Paid' ? `PAID (${method.toUpperCase()})` : 'UNPAID';
            const statusColor = invoice.paymentStatus === 'Paid' ? '#10b981' : '#ef4444'; // Emerald vs Red

            doc.fillColor(statusColor).text(statusText, 135, y);

            // Terms and Conditions Section (Compact)
            doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold').text('Terms & Conditions:', 50, y + 25);
            doc.fontSize(8).font('Helvetica').fillColor(secondaryColor);
            doc.text('1. This is an electronically generated invoice and does not require a physical signature.', 50, y + 37);
            doc.text('2. All disputes are subject to Lucknow jurisdiction.', 50, y + 47);

            // Promotional Footer
            doc.fontSize(9).font('Helvetica-Bold').fillColor(primaryColor);
            doc.text('Thank you for choosing WattOrbit!', 50, 805, { align: 'center' });
            doc.fontSize(8).font('Helvetica').fillColor(secondaryColor);
            doc.text('⚡ Powering your space with sustainable energy solutions. Visit us at www.wattorbit.in', 50, 815, { align: 'center' });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
};

module.exports = { generateInvoicePDF };
