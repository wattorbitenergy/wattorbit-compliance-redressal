const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Generate Professional & Audit-Ready Invoice PDF
 * Compliant with GST Invoice Rules 2017:
 *   - Booking reference number
 *   - SAC code per line item
 *   - CGST/SGST bifurcation (intrastate) or IGST (interstate)
 *   - Bank details
 *   - Correct taxable value, tax amounts, and grand total
 *
 * @param {Object} invoice - Invoice object (populated from DB)
 * @param {Object} options  - { buffer: true } to return Buffer instead of PDFDocument
 * @returns {Promise<PDFDocument|Buffer>}
 */
const generateInvoicePDF = (invoice, options = {}) => {
    return new Promise((resolve, reject) => {
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

            // ─── HEADER ───────────────────────────────────────────────
            const logoPath = path.join(__dirname, '../assets/logo.jpg');
            if (fs.existsSync(logoPath)) {
                doc.image(logoPath, 30, 30, { width: 60 });
            }

            doc.fontSize(20).font('Helvetica-Bold').fillColor(primaryColor).text('TAX INVOICE', { align: 'right' });
            doc.fontSize(9).font('Helvetica').fillColor(secondaryColor).text('Original for Recipient', { align: 'right' });
            doc.moveDown(0.5);

            // Business Identity
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000')
               .text(invoice.businessName || 'WATTORBIT ENERGY SOLUTIONS LLP', { align: 'right' });
            doc.fontSize(8).font('Helvetica').fillColor(secondaryColor);
            doc.text(invoice.businessAddress || 'Shop No.3, INDAURABAG, BKT LUCKNOW - 226201', { align: 'right' });
            doc.text(`GSTIN: ${invoice.businessGST || '09AAFFW4253N1ZL'} | PAN: ${invoice.businessPAN || 'AAFFW4253N'}`, { align: 'right' });
            doc.text('Email: support@wattorbit.in | Web: www.wattorbit.in', { align: 'right' });

            doc.moveDown(1);
            doc.lineWidth(0.5).strokeColor(borderColor).moveTo(30, 115).lineTo(565, 115).stroke();

            // ─── INFO GRID ────────────────────────────────────────────
            const gridY = 130;

            // Left: Invoice Details
            doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold').text('INVOICE DETAILS', 30, gridY);
            doc.font('Helvetica').fontSize(8).fillColor(secondaryColor);
            doc.text('Invoice No:',     30, gridY + 15);
            doc.text('Booking Ref:',    30, gridY + 27);
            doc.text('Invoice Date:',   30, gridY + 39);
            doc.text('Place of Supply:',30, gridY + 51);
            doc.text('Reverse Charge:', 30, gridY + 63);

            doc.fillColor('#000000').font('Helvetica-Bold');
            doc.text(invoice.invoiceId, 115, gridY + 15);
            // Booking reference — use stored bookingRef, or populated bookingId.bookingId, or N/A
            const bookingRefText = invoice.bookingRef
                || (invoice.bookingId && typeof invoice.bookingId === 'object' ? invoice.bookingId.bookingId : null)
                || 'N/A';
            doc.text(bookingRefText, 115, gridY + 27);
            const dateStr = new Date(invoice.invoiceDate).toLocaleDateString('en-GB');
            doc.text(dateStr, 115, gridY + 39);
            doc.text(`${invoice.placeOfSupply || 'Uttar Pradesh'} (${invoice.stateCode || '09'})`, 115, gridY + 51);
            doc.text('No', 115, gridY + 63);

            // Right: Bill To
            doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold').text('BILL TO (BUYER)', 320, gridY);
            doc.font('Helvetica-Bold').fontSize(9).text(invoice.customerName, 320, gridY + 15);
            doc.font('Helvetica').fontSize(8).fillColor(secondaryColor);
            doc.text(invoice.customerAddress, 320, gridY + 27, { width: 245 });
            doc.text(`Phone: ${invoice.customerPhone}`, 320, doc.y + 2);
            if (invoice.customerGST) doc.text(`GSTIN: ${invoice.customerGST}`, 320, doc.y + 2);

            doc.moveDown(2);

            // ─── LINE ITEMS TABLE ─────────────────────────────────────
            // Total width = 535px across 9 columns
            // Discount is distributed proportionally across items by taxable value
            const cols = {
                desc:     { x: 30,  w: 145, label: 'Description of Services/Goods' },
                sac:      { x: 175, w: 52,  label: 'SAC/HSN' },
                qty:      { x: 227, w: 22,  label: 'Qty' },
                rate:     { x: 249, w: 46,  label: 'Rate' },
                taxable:  { x: 295, w: 52,  label: 'Taxable Val' },
                discount: { x: 347, w: 42,  label: 'Discount' },
                gstRate:  { x: 389, w: 48,  label: 'GST Rate' },
                gstAmt:   { x: 437, w: 50,  label: 'GST Amt' },
                total:    { x: 487, w: 78,  label: 'Total' },
            };

            let y = Math.max(doc.y, gridY + 95);

            // Table header background
            doc.rect(30, y, 535, 25).fill(primaryColor);
            doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7);
            Object.values(cols).forEach(c => {
                doc.text(c.label, c.x + 3, y + 9, { width: c.w - 4, align: c.label === 'Description of Services/Goods' ? 'left' : 'center' });
            });

            y += 25;
            doc.fillColor('#000000').font('Helvetica').fontSize(7);

            invoice.items.forEach((item, index) => {
                // Use the bearer-assigned discount per line item (set by coupon config)
                // NOT a proportional calculation — reflects actual coupon bearer rules
                const itemDiscount = parseFloat((item.discountShare || 0).toFixed(2));
                // Line total: taxable - actual discount borne + tax
                const itemTotal = parseFloat((item.taxableValue - itemDiscount + (item.taxAmount || 0)).toFixed(2));

                const rowHeight = Math.max(28, doc.heightOfString(item.description, { width: cols.desc.w - 5 }) + 12);

                if (index % 2 === 1) doc.rect(30, y, 535, rowHeight).fill('#f8fafc');
                doc.fillColor('#000000');

                doc.text(item.description,             cols.desc.x + 3,     y + 7, { width: cols.desc.w - 5 });
                doc.text(item.hsnSac || '',            cols.sac.x + 3,      y + 7, { width: cols.sac.w - 4,     align: 'center' });
                doc.text(String(item.quantity),        cols.qty.x + 3,      y + 7, { width: cols.qty.w - 4,     align: 'center' });
                doc.text(item.unitPrice.toFixed(2),    cols.rate.x + 3,     y + 7, { width: cols.rate.w - 4,    align: 'right'  });
                doc.text(item.taxableValue.toFixed(2), cols.taxable.x + 3,  y + 7, { width: cols.taxable.w - 4, align: 'right'  });

                // Discount column — actual amount borne by this fee type per coupon bearer config
                doc.text(
                    itemDiscount > 0 ? itemDiscount.toFixed(2) : '-',
                    cols.discount.x + 3, y + 7,
                    { width: cols.discount.w - 4, align: 'right' }
                );

                // GST Rate — CGST%+SGST% or IGST%
                let gstRateLabel = 'Nil';
                if ((item.igstRate || 0) > 0) {
                    gstRateLabel = `IGST\n${item.igstRate}%`;
                } else if ((item.cgstRate || 0) > 0) {
                    gstRateLabel = `C:${item.cgstRate}%\nS:${item.sgstRate}%`;
                }
                doc.text(gstRateLabel, cols.gstRate.x + 3, y + 4, { width: cols.gstRate.w - 4, align: 'center' });

                // GST Amount — CGST/SGST split or IGST
                let gstAmtLabel = '0.00';
                if ((item.igstAmount || 0) > 0) {
                    gstAmtLabel = item.igstAmount.toFixed(2);
                } else if ((item.cgstAmount || 0) > 0) {
                    gstAmtLabel = `${item.cgstAmount.toFixed(2)}\n${item.sgstAmount.toFixed(2)}`;
                }
                doc.text(gstAmtLabel, cols.gstAmt.x + 3, y + 4, { width: cols.gstAmt.w - 4, align: 'right' });

                // Total (taxable - discount + tax)
                doc.text(itemTotal.toFixed(2), cols.total.x + 3, y + 7, { width: cols.total.w - 6, align: 'right' });

                y += rowHeight;

                if (y > 700) {
                    doc.addPage();
                    y = 30;
                }
            });

            // Table border
            doc.rect(30, 255, 535, y - 255).strokeColor(borderColor).stroke();

            // ─── SUMMARY ──────────────────────────────────────────────
            y += 10;
            const summaryX = 330;
            const valX = 475; // Shifted left to prevent right-edge clipping
            doc.fontSize(8).fillColor(secondaryColor);

            const addSummaryRow = (label, value, isBold = false, color = '#000000') => {
                doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fillColor(color)
                   .text(label, summaryX, y, { width: 140, align: 'right' });
                doc.text(`₹${value}`, valX, y, { width: 85, align: 'right' });
                y += 15;
            };

            addSummaryRow('Total Taxable Value:', invoice.subtotal.toFixed(2));

            // Show correct GST bifurcation
            if ((invoice.totalIGST || 0) > 0) {
                addSummaryRow('Integrated Tax (IGST) @18%:', invoice.totalIGST.toFixed(2));
            } else {
                addSummaryRow(`Central Tax (CGST) @${(invoice.totalCGST / invoice.subtotal * 100 || 9).toFixed(0)}%:`, (invoice.totalCGST || 0).toFixed(2));
                addSummaryRow(`State Tax (SGST) @${(invoice.totalSGST / invoice.subtotal * 100 || 9).toFixed(0)}%:`, (invoice.totalSGST || 0).toFixed(2));
            }

            if ((invoice.discount || 0) > 0) {
                // Discount is already distributed per line item in the Discount column above.
                // Show as an informational note in the summary (not deducted again).
                doc.font('Helvetica').fillColor('#6b7280').fontSize(7)
                   .text(`* Discount of ₹${invoice.discount.toFixed(2)} is distributed across line items above.`, summaryX, y, { width: 230, align: 'right' });
                y += 12;
            }

            if ((invoice.pointsUsed || 0) > 0) {
                addSummaryRow('Less: Cash Points Used:', invoice.pointsUsed.toFixed(2), false, '#ef4444');
            }

            // Grand total bar
            doc.rect(330, y - 2, 235, 22).fill(primaryColor);
            doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
            doc.text('Total Invoice Value:', 340, y + 5);
            doc.text(`₹${invoice.totalAmount.toFixed(2)}`, valX, y + 5, { width: 85, align: 'right' });

            // Amount in words
            y += 32;
            doc.fillColor('#000000').font('Helvetica-Bold').fontSize(8).text('Total Amount (in words):', 30, y);
            doc.font('Helvetica').fontSize(8).text(invoice.amountInWords || '', 30, y + 12, { width: 290 });

            // ─── BANK DETAILS & SIGNATURE ────────────────────────────
            y += 45;
            doc.rect(30, y, 260, 90).strokeColor(borderColor).stroke();
            doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000').text('BANK DETAILS', 38, y + 7);

            const bank = invoice.bankDetails || {};
            const hasBank = bank.accountNumber && bank.accountNumber !== 'N/A' && bank.accountNumber !== '';

            doc.font('Helvetica').fontSize(7).fillColor(secondaryColor);
            if (hasBank) {
                doc.text(`A/c Name: ${bank.accountHolderName || invoice.businessName}`, 38, y + 20);
                doc.text(`A/c No:   ${bank.accountNumber}`,                             38, y + 32);
                doc.text(`Bank:     ${bank.bankName || '—'}`,                           38, y + 44);
                doc.text(`IFSC:     ${bank.ifscCode || '—'}`,                           38, y + 56);
                doc.text(`Branch:   ${bank.branchName || '—'}`,                         38, y + 68);
            } else {
                doc.fillColor('#ef4444').text('Bank details not configured.', 38, y + 22);
                doc.fillColor(secondaryColor).text('Contact: support@wattorbit.in', 38, y + 34);
                doc.text('for payment instructions.', 38, y + 44);
            }

            // Certification & Signature (Right)
            doc.fontSize(7).fillColor(secondaryColor).text('CERTIFICATION:', 310, y + 5);
            doc.text('Certified that the particulars given above are true and correct.', 310, y + 17, { width: 255 });
            doc.fillColor('#000000').font('Helvetica-Bold').fontSize(8)
               .text(`For ${invoice.businessName || 'WATTORBIT ENERGY SOLUTIONS LLP'}`, 310, y + 55, { align: 'right', width: 255 });
            doc.font('Helvetica').fontSize(6).fillColor(secondaryColor)
               .text('Authorised Signatory', 310, y + 68, { align: 'right', width: 255 });

            // Footer
            y += 100;
            doc.lineWidth(0.5).strokeColor(borderColor).moveTo(30, y).lineTo(565, y).stroke();
            
            // Promotional Footer
            doc.font('Helvetica-Bold').fontSize(8).fillColor(primaryColor)
               .text('Download our App | Visit www.wattorbit.in | Mail: support@wattorbit.in', 30, y + 8, { align: 'center', width: 535 });
            
            // Computer generated warning
            doc.font('Helvetica').fontSize(6).fillColor(secondaryColor)
               .text('This is a computer-generated invoice and does not require a physical signature.', 30, y + 22, { align: 'center', width: 535 });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
};

module.exports = { generateInvoicePDF };
