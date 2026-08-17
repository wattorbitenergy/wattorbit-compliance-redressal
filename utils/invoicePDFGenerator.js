const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const https = require('https');

const fetchImage = (url) => {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                return resolve(null); // Silent fail if QR fails
            }
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', (err) => resolve(null));
    });
};

/**
 * Generate Professional & Audit-Ready Invoice PDF
 * @param {Object} invoice - Invoice object with populated details
 * @param {Object} options - Options like { buffer: true }
 * @returns {Promise<PDFDocument|Buffer>}
 */
const generateInvoicePDF = async (invoice, options = {}) => {
    return new Promise(async (resolve, reject) => {
        try {
            const doc = new PDFDocument({
                margin: 30,
                size: 'A4',
                info: {
                    Title: `Tax Invoice - ${invoice.invoiceId}`,
                    Author: 'WATTORBIT ENERGY SOLUTIONS LLP'
                }
            });

            if (options.buffer) {
                const buffers = [];
                doc.on('data', buffers.push.bind(buffers));
                doc.on('end', () => resolve(Buffer.concat(buffers)));
            } else {
                resolve(doc);
            }

            const primaryColor = '#1e3a8a';
            const secondaryColor = '#4b5563';
            const borderColor = '#cbd5e1';

            // --- HEADER ---
            const logoPath = path.join(__dirname, '../assets/logo.jpg');
            if (fs.existsSync(logoPath)) {
                doc.image(logoPath, 30, 30, { width: 60 });
            }

            doc.fontSize(20).font('Helvetica-Bold').fillColor(primaryColor).text('TAX INVOICE', { align: 'right' });
            doc.fontSize(9).font('Helvetica').fillColor(secondaryColor).text(`Original for Recipient`, { align: 'right' });
            doc.moveDown(0.5);

            // Business Identity
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text(invoice.businessName || 'WATTORBIT ENERGY SOLUTIONS LLP', { align: 'right' });
            doc.fontSize(8).font('Helvetica').fillColor(secondaryColor);
            doc.text(invoice.businessAddress || 'Shop No.3, INDAURABAG, BKT LUCKNOW - 226201', { align: 'right' });
            doc.text(`GSTIN: ${invoice.businessGST || '09AAFFW4253N1ZL'} | PAN: ${invoice.businessPAN || 'AAFFW4253N'}`, { align: 'right' });
            doc.text('Email: support@wattorbit.in | Web: www.wattorbit.in', { align: 'right' });

            doc.moveDown(1);
            doc.lineWidth(0.5).strokeColor(borderColor).moveTo(30, 115).lineTo(565, 115).stroke();

            // --- INFO GRID ---
            const gridY = 130;
            // Invoice Details (Left)
            doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold').text('INVOICE DETAILS', 30, gridY);
            doc.font('Helvetica').fontSize(8).fillColor(secondaryColor);
            doc.text('Invoice No:', 30, gridY + 15);
            doc.text('Invoice Date:', 30, gridY + 27);
            doc.text('Place of Supply:', 30, gridY + 39);
            doc.text('Reverse Charge:', 30, gridY + 51);

            doc.fillColor('#000000').font('Helvetica-Bold');
            doc.text(invoice.invoiceId, 100, gridY + 15);
            const dateStr = new Date(invoice.invoiceDate).toLocaleDateString('en-GB');
            doc.text(dateStr, 100, gridY + 27);
            doc.text(`${invoice.placeOfSupply || 'Uttar Pradesh'} (${invoice.stateCode || '09'})`, 100, gridY + 39);
            doc.text('No', 100, gridY + 51);

            // Bill To (Right)
            doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold').text('BILL TO (BUYER)', 320, gridY);
            doc.font('Helvetica-Bold').fontSize(9).text(invoice.customerName, 320, gridY + 15);
            doc.font('Helvetica').fontSize(8).fillColor(secondaryColor);
            doc.text(invoice.customerAddress, 320, gridY + 27, { width: 245 });
            doc.text(`Phone: ${invoice.customerPhone}`, 320, doc.y + 2);
            if (invoice.customerGST) doc.text(`GSTIN: ${invoice.customerGST}`, 320, doc.y + 2);

            doc.moveDown(2);

            // --- TABLE ---
            let y = Math.max(doc.y, gridY + 80);
            const tableHeaders = [
                { label: 'Description of Services/Goods', x: 30, w: 140 },
                { label: 'HSN/SAC', x: 170, w: 40 },
                { label: 'Qty', x: 210, w: 25 },
                { label: 'Rate', x: 235, w: 40 },
                { label: 'Disc', x: 275, w: 35 },
                { label: 'Taxable Val', x: 310, w: 50 },
                { label: 'GST', x: 360, w: 120 }, // Combined for nested info
                { label: 'Total', x: 480, w: 85 }
            ];

            // Header Background
            doc.rect(30, y, 535, 25).fill(primaryColor);
            doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7);
            
            tableHeaders.forEach(h => {
                if (h.label === 'GST') {
                    doc.text('GST Rate', h.x + 5, y + 5, { width: 50, align: 'center' });
                    doc.text('GST Amount', h.x + 60, y + 5, { width: 50, align: 'center' });
                } else {
                    doc.text(h.label, h.x + 5, y + 8, { width: h.w - 10, align: h.label === 'Description of Services/Goods' ? 'left' : 'right' });
                }
            });

            y += 25;
            doc.fillColor('#000000').font('Helvetica').fontSize(7);

            invoice.items.forEach((item, index) => {
                const rowHeight = Math.max(25, doc.heightOfString(item.description, { width: 130 }) + 10);
                
                if (index % 2 === 1) doc.rect(30, y, 535, rowHeight).fill('#f8fafc');
                doc.fillColor('#000000');

                doc.text(item.description, 35, y + 7, { width: 130 });
                doc.text(item.hsnSac || '', 170, y + 7, { width: 40, align: 'center' });
                doc.text(item.quantity, 210, y + 7, { width: 25, align: 'center' });
                doc.text(item.unitPrice.toFixed(2), 235, y + 7, { width: 40, align: 'right' });
                doc.text((item.discount || 0).toFixed(2), 275, y + 7, { width: 35, align: 'right' });
                doc.text(item.taxableValue.toFixed(2), 310, y + 7, { width: 50, align: 'right' });

                // GST Detail
                const taxRateText = item.igstRate > 0 ? `IGST ${item.igstRate}%` : `C+S ${item.cgstRate + item.sgstRate}%`;
                doc.text(taxRateText, 365, y + 7, { width: 50, align: 'center' });
                doc.text(item.taxAmount.toFixed(2), 420, y + 7, { width: 50, align: 'right' });

                doc.text(item.total.toFixed(2), 485, y + 7, { width: 75, align: 'right' });

                y += rowHeight;

                if (y > 700) {
                    doc.addPage();
                    y = 30;
                }
            });

            // Table Border
            doc.rect(30, 260, 535, y - 260).strokeColor(borderColor).stroke();

            // --- SUMMARY ---
            y += 10;
            const summaryX = 350;
            const valX = 485;
            doc.fontSize(8).fillColor(secondaryColor);

            const addSummaryRow = (label, value, isBold = false, color = '#000000') => {
                doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fillColor(color).text(label, summaryX, y, { width: 130, align: 'right' });
                doc.text(`₹${value}`, valX, y, { width: 80, align: 'right' });
                y += 15;
            };

            addSummaryRow('Total Taxable Value:', invoice.subtotal.toFixed(2));
            if (invoice.totalIGST > 0) {
                addSummaryRow('Integrated Tax (IGST):', invoice.totalIGST.toFixed(2));
            } else {
                addSummaryRow('Central Tax (CGST):', invoice.totalCGST.toFixed(2));
                addSummaryRow('State Tax (SGST):', invoice.totalSGST.toFixed(2));
            }
            
            if (invoice.discount > 0) addSummaryRow('Less Discount:', invoice.discount.toFixed(2), false, '#ef4444');

            doc.rect(350, y - 2, 215, 20).fill(primaryColor);
            doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
            doc.text('Total Invoice Value:', 360, y + 4);
            doc.text(`₹${invoice.totalAmount.toFixed(2)}`, valX, y + 4, { width: 80, align: 'right' });

            // Amount in words
            y += 30;
            doc.fillColor('#000000').font('Helvetica-Bold').fontSize(8).text('Total Amount (in words):', 30, y);
            doc.font('Helvetica').text(invoice.amountInWords || '', 30, y + 12);

            // --- BANK & FOOTER ---
            y += 40;

            // Payment Reference (for online payments)
            if (invoice.paymentStatus === 'Paid' && invoice.paymentReference) {
                doc.rect(30, y, 535, 20).fill('#f0fdf4').strokeColor('#bbf7d0').stroke();
                doc.fillColor('#15803d').font('Helvetica-Bold').fontSize(9).text('PAID', 35, y + 5);
                doc.fillColor('#166534').font('Helvetica').fontSize(7).text(`Transaction Ref: ${invoice.paymentReference}`, 65, y + 6);
                y += 30;
            }

            doc.rect(30, y, 220, 70).strokeColor(borderColor).stroke();
            doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000').text('BANK DETAILS', 35, y + 5);
            doc.font('Helvetica').fontSize(7).fillColor(secondaryColor);
            const bank = invoice.bankDetails || {};
            doc.text(`A/c Name: ${bank.accountHolderName || invoice.businessName}`, 35, y + 18);
            doc.text(`A/c No: ${bank.accountNumber || 'N/A'}`, 35, y + 28);
            doc.text(`Bank: ${bank.bankName || 'N/A'}`, 35, y + 38);
            doc.text(`IFSC: ${bank.ifscCode || 'N/A'}`, 35, y + 48);
            doc.text(`Branch: ${bank.branchName || 'N/A'}`, 35, y + 58);

            // Fetch and render UPI QR
            if (bank.upiId) {
                const upiString = `upi://pay?pa=${encodeURIComponent(bank.upiId)}&pn=${encodeURIComponent(bank.accountHolderName || invoice.businessName)}&am=${invoice.totalAmount.toFixed(2)}&cu=INR`;
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(upiString)}`;
                const qrBuffer = await fetchImage(qrUrl);
                if (qrBuffer) {
                    doc.image(qrBuffer, 260, y, { width: 55 });
                    doc.font('Helvetica-Bold').fontSize(7).fillColor('#1e40af').text('Scan to Pay', 260, y + 58, { width: 55, align: 'center' });
                }
            }

            // Certification
            doc.fontSize(7).fillColor(secondaryColor).text('CERTIFICATION:', 320, y);
            doc.text('Certified that the particulars given above are true and correct.', 320, y + 10, { width: 245 });
            doc.moveDown(2);
            doc.fillColor('#000000').font('Helvetica-Bold').text(`For ${invoice.businessName}`, 320, doc.y, { align: 'right' });
            doc.moveDown(3);
            doc.font('Helvetica').fontSize(6).text('This is a computer generated invoice and does not require physical signature.', 320, doc.y, { align: 'right' });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
};

module.exports = { generateInvoicePDF };
