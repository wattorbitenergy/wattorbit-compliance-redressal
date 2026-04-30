const Invoice = require('../models/Invoice');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const Config = require('../models/Config');
const { generateInvoiceId } = require('./idGenerator');
const { convertNumberToWords } = require('./numberToWords');

const SELLER_STATE = 'uttar pradesh';
const SELLER_STATE_CODE = '09';
// SAC 998719 — Maintenance/repair of other machinery & equipment (AC repair services)
const DEFAULT_SAC = '998719';

/**
 * Determine if a sale is intrastate (CGST+SGST) or interstate (IGST)
 * based on buyer's state vs. WattOrbit's base state (UP)
 */
function isIntrastateSupply(buyerState = '') {
    const s = buyerState.toLowerCase().trim();
    return s.includes('uttar pradesh') || s.includes('u.p') || s === 'up';
}

/**
 * Process a raw line item and compute CGST/SGST or IGST amounts correctly.
 * @param {Object} item - { description, hsnSac, quantity, unitPrice, taxableValue, taxRate }
 * @param {Boolean} intrastate
 * @returns enriched item with cgstAmount, sgstAmount, igstAmount, taxAmount, total
 */
function processItem(item, intrastate) {
    const taxableValue = parseFloat((item.taxableValue || 0).toFixed(2));
    const rate = item.taxRate || 0;
    let cgstRate = 0, sgstRate = 0, igstRate = 0;
    let cgstAmount = 0, sgstAmount = 0, igstAmount = 0;

    if (rate > 0) {
        if (intrastate) {
            cgstRate = rate / 2;
            sgstRate = rate / 2;
            cgstAmount = parseFloat((taxableValue * cgstRate / 100).toFixed(2));
            sgstAmount = parseFloat((taxableValue * sgstRate / 100).toFixed(2));
        } else {
            igstRate = rate;
            igstAmount = parseFloat((taxableValue * igstRate / 100).toFixed(2));
        }
    }

    const taxAmount = parseFloat((cgstAmount + sgstAmount + igstAmount).toFixed(2));
    const total = parseFloat((taxableValue + taxAmount).toFixed(2));

    return {
        description: item.description,
        hsnSac: item.hsnSac || DEFAULT_SAC,
        quantity: item.quantity || 1,
        unitPrice: item.unitPrice,
        taxableValue,
        taxRate: rate,
        taxAmount,
        cgstRate,
        cgstAmount,
        sgstRate,
        sgstAmount,
        igstRate,
        igstAmount,
        // Discount borne by this line item's fee type (set by coupon bearer config)
        discountShare: parseFloat((item.discountShare || 0).toFixed(2)),
        total
    };
}

/**
 * Automatically generate an invoice for a booking if one doesn't exist.
 * @param {String} bookingId - MongoDB ObjectId of the booking
 * @returns {Promise<Object|null>} - The generated invoice or null if failed/exists
 */
async function autoGenerateInvoice(bookingId) {
    try {
        // Get booking with all necessary refs
        const booking = await Booking.findById(bookingId)
            .populate('userId')
            .populate('serviceId')
            .populate('packageId')
            .populate('addressId');

        if (!booking) {
            console.error(`Booking ${bookingId} not found for invoice generation`);
            return null;
        }

        // 🛡️ Check if invoice exists to preserve invoiceId
        const existingInvoice = await Invoice.findOne({ bookingId });

        // Fetch bank & business details from Config
        const bankConfig = await Config.findOne({ key: 'bank_details' });
        const biz = bankConfig?.value || {};

        // Determine tax type
        const buyerState = booking.addressId?.state || '';
        const intrastate = isIntrastateSupply(buyerState);

        const payment = await Payment.findOne({ bookingId });
        const invoiceId = existingInvoice ? existingInvoice.invoiceId : await generateInvoiceId();

        // --- Build line items ---
        const invoiceItems = [];
        let totalTaxable = 0;
        let totalCGST = 0;
        let totalSGST = 0;
        let totalIGST = 0;

        const sacCode = booking.packageId?.sacCode || booking.serviceId?.sacCode || DEFAULT_SAC;

        // Split out dynamic charges from tech/platform fees for accurate display
        let baseTechFee = booking.technicianCharges || 0;
        let basePlatformFee = booking.platformFees || 0;

        if (booking.appliedDynamicCharges && booking.appliedDynamicCharges.length > 0) {
            booking.appliedDynamicCharges.forEach(charge => {
                if (charge.recipient === 'Technician') baseTechFee -= charge.amount;
                else basePlatformFee -= charge.amount;
            });
        }

        // 1 & 2. Services (Technician and Platform Fees)
        const servicesArray = booking.services && booking.services.length > 0
            ? booking.services
            : [{
                name: `${booking.serviceId?.name || 'Service'} - ${booking.packageId?.name || ''}`,
                technicianCharges: baseTechFee,
                platformFees: basePlatformFee
            }];

        // Calculate total fees across all services to proportionally distribute the discount shares
        const totalTechFees = servicesArray.reduce((sum, s) => sum + (s.technicianCharges || 0), 0);
        const totalPlatFees = servicesArray.reduce((sum, s) => sum + (s.platformFees || 0), 0);

        servicesArray.forEach(svc => {
            const svcTechFee = svc.technicianCharges || 0;
            const svcPlatFee = svc.platformFees || 0;
            
            // Proportional share of the overall tech/platform discount for this specific service
            const techDiscount = totalTechFees > 0 
                ? parseFloat(((booking.technicianDiscountShare || 0) * (svcTechFee / totalTechFees)).toFixed(2)) 
                : 0;
                
            const platDiscount = totalPlatFees > 0 
                ? parseFloat(((booking.platformDiscountShare || 0) * (svcPlatFee / totalPlatFees)).toFixed(2)) 
                : 0;

            if (svcTechFee > 0) {
                const item = processItem({
                    description: `${svc.name} (Technician Fee)`,
                    hsnSac: sacCode,
                    quantity: 1,
                    unitPrice: svcTechFee,
                    taxableValue: svcTechFee,
                    taxRate: 0,
                    discountShare: techDiscount
                }, intrastate);
                invoiceItems.push(item);
                totalTaxable += item.taxableValue;
            }

            if (svcPlatFee > 0) {
                const item = processItem({
                    description: `${svc.name} (Platform Fee)`,
                    hsnSac: sacCode,
                    quantity: 1,
                    unitPrice: svcPlatFee,
                    taxableValue: svcPlatFee,
                    taxRate: 18,
                    discountShare: platDiscount
                }, intrastate);
                invoiceItems.push(item);
                totalTaxable += item.taxableValue;
                totalCGST += item.cgstAmount;
                totalSGST += item.sgstAmount;
                totalIGST += item.igstAmount;
            }
        });

        // 3. Dynamic Surcharges
        if (booking.appliedDynamicCharges && booking.appliedDynamicCharges.length > 0) {
            booking.appliedDynamicCharges.forEach(charge => {
                const item = processItem({
                    description: `Surcharge: ${charge.name}`,
                    hsnSac: sacCode,
                    quantity: 1,
                    unitPrice: charge.amount,
                    taxableValue: charge.amount,
                    taxRate: charge.recipient === 'Technician' ? 0 : 18
                }, intrastate);
                invoiceItems.push(item);
                totalTaxable += item.taxableValue;
                totalCGST += item.cgstAmount;
                totalSGST += item.sgstAmount;
                totalIGST += item.igstAmount;
            });
        }

        // 4. Materials / Spare Parts
        if (booking.materialsUsed && booking.materialsUsed.length > 0) {
            booking.materialsUsed.forEach(m => {
                const item = processItem({
                    description: `Spare Part: ${m.name}${m.make ? ' [' + m.make + ']' : ''}`,
                    hsnSac: m.hsnCode || '',
                    quantity: m.quantity,
                    unitPrice: m.sellingPrice,
                    taxableValue: m.sellingPrice * m.quantity,
                    taxRate: m.sellingTaxRate || 0
                }, intrastate);
                invoiceItems.push(item);
                totalTaxable += item.taxableValue;
                totalCGST += item.cgstAmount;
                totalSGST += item.sgstAmount;
                totalIGST += item.igstAmount;
            });
        }

        // --- Totals ---
        const totalTaxAmount = parseFloat((totalCGST + totalSGST + totalIGST).toFixed(2));
        const grandTotal = parseFloat((totalTaxable + totalTaxAmount - (booking.discount || 0) - (booking.pointsUsed || 0)).toFixed(2));
        const amountWords = convertNumberToWords(grandTotal);

        // Format address
        const addr = booking.addressId;
        const customerAddress = [
            addr?.flatNo, addr?.building, addr?.street,
            addr?.landmark, addr?.city,
            `${addr?.state} - ${addr?.pincode}`
        ].filter(Boolean).join(', ');

        const invoiceData = {
            invoiceId,
            bookingRef: booking.bookingId,
            bookingId,
            userId: booking.userId._id,
            // Preserve original dates if updating
            invoiceDate: existingInvoice ? existingInvoice.invoiceDate : new Date(),
            dueDate: existingInvoice ? existingInvoice.dueDate : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            items: invoiceItems,
            subtotal: parseFloat(totalTaxable.toFixed(2)),
            taxAmount: totalTaxAmount,
            discount: booking.discount || 0,
            platformDiscountShare: parseFloat((booking.platformDiscountShare || 0).toFixed(2)),
            technicianDiscountShare: parseFloat((booking.technicianDiscountShare || 0).toFixed(2)),
            couponCode: booking.couponCode || null,
            pointsUsed: booking.pointsUsed || 0,
            totalAmount: grandTotal,
            amountInWords: amountWords,
            totalCGST: parseFloat(totalCGST.toFixed(2)),
            totalSGST: parseFloat(totalSGST.toFixed(2)),
            totalIGST: parseFloat(totalIGST.toFixed(2)),
            placeOfSupply: buyerState || 'Uttar Pradesh',
            stateCode: intrastate ? SELLER_STATE_CODE : '',
            paymentStatus: (payment && payment.status === 'Paid') || booking.paymentReceived ? 'Paid' : 'Unpaid',
            paidAmount: (payment && payment.status === 'Paid') || booking.paymentReceived ? grandTotal : 0,
            businessName: biz.accountHolderName || 'WATTORBIT ENERGY SOLUTIONS LLP',
            businessGST: biz.gstNumber || '09AAFFW4253N1ZL',
            businessPAN: biz.panNumber || 'AAFFW4253N',
            businessAddress: biz.address || 'Shop No.3, INDAURABAG, BKT LUCKNOW - 226201',
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
        };

        let invoice;
        if (existingInvoice) {
            invoice = await Invoice.findOneAndUpdate(
                { bookingId },
                { $set: invoiceData },
                { new: true }
            );
            console.log(`✅ Updated existing invoice ${invoiceId} for booking ${booking.bookingId}`);
        } else {
            invoice = new Invoice(invoiceData);
            await invoice.save();
            console.log(`✅ Auto-generated new invoice ${invoiceId} for booking ${booking.bookingId}`);
        }
        return invoice;
    } catch (err) {
        console.error('Error in autoGenerateInvoice:', err);
        return null;
    }
}

module.exports = { autoGenerateInvoice };
