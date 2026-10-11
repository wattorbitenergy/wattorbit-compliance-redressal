const Invoice = require('../models/Invoice');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const Config = require('../models/Config');
const { generateInvoiceId } = require('./idGenerator');

/**
 * Automatically generate an invoice for a booking if one doesn't exist
 * @param {String} bookingId - The ID of the booking
 * @returns {Promise<Object|null>} - The generated invoice or null if failed/exists
 */
async function autoGenerateInvoice(bookingId) {
    try {
        // 🛡️ REVISION: If invoice exists, update its payment status/paid amount instead of doing nothing.
        // This ensures the Invoice ID remains stable and the document stays in sync with booking updates.
        const existingInvoice = await Invoice.findOne({ bookingId });
        if (existingInvoice) {
            console.log(`Invoice already exists for booking ${bookingId}, checking for status updates...`);
            
            // Get payment details if any
            const payment = await Payment.findOne({ bookingId });
            const booking = await Booking.findById(bookingId);
            
            if (booking) {
                const isPaid = (payment && payment.status === 'Paid') || booking.paymentReceived;
                existingInvoice.paymentStatus = isPaid ? 'Paid' : 'Unpaid';
                existingInvoice.paidAmount = isPaid ? booking.totalAmount : 0;
                await existingInvoice.save();
            }
            return existingInvoice;
        }

        // Get booking details with all info needed for invoice
        const booking = await Booking.findById(bookingId)
            .populate('userId')
            .populate('serviceId')
            .populate('packageId')
            .populate('addressId');

        if (!booking) {
            console.error(`Booking ${bookingId} not found for invoice generation`);
            return null;
        }

        // Get payment details if any
        const payment = await Payment.findOne({ bookingId });

        const invoiceId = await generateInvoiceId();

        // Build line items split into components
        // 1. Base Technician and Platform Fees without dynamic charges
        // We know that `booking.technicianCharges` and `booking.platformFees` currently include the dynamic charges based on routing.
        // To show them accurately, we subtract the dynamic charges that were added, and later list them separate.

        let baseTechFee = booking.technicianCharges || 0;
        let basePlatformFee = booking.platformFees || 0;

        if (booking.appliedDynamicCharges && booking.appliedDynamicCharges.length > 0) {
            booking.appliedDynamicCharges.forEach(charge => {
                if (charge.recipient === 'Technician') {
                    baseTechFee -= charge.amount;
                } else {
                    basePlatformFee -= charge.amount;
                }
            });
        }

        const sellerStateCode = '09';
        const sellerState = 'Uttar Pradesh';
        const buyerState = booking.addressId?.state || '';
        const isIntrastate = buyerState.toLowerCase().includes(sellerState.toLowerCase()) || 
                             buyerState.toLowerCase().includes('u.p') || 
                             buyerState.toLowerCase().includes('up');

        let totalTaxable = 0;
        let totalCGST = 0;
        let totalSGST = 0;
        let totalIGST = 0;

        const processAutoItem = (item) => {
            const taxableValue = parseFloat((item.taxableValue || 0).toFixed(2));
            const rate = parseFloat(item.taxRate || 0);
            let cgst = 0, sgst = 0, igst = 0;

            if (rate > 0) {
                if (isIntrastate) {
                    cgst = parseFloat((taxableValue * (rate / 2) / 100).toFixed(2));
                    sgst = parseFloat((taxableValue * (rate / 2) / 100).toFixed(2));
                } else {
                    igst = parseFloat((taxableValue * rate / 100).toFixed(2));
                }
            }

            totalTaxable += taxableValue;
            totalCGST += cgst;
            totalSGST += sgst;
            totalIGST += igst;

            return {
                description: item.description,
                hsnSac: item.hsnSac || '',
                quantity: item.quantity || 1,
                unitPrice: item.unitPrice,
                taxableValue,
                taxRate: rate,
                cgstRate: isIntrastate ? rate / 2 : 0,
                cgstAmount: cgst,
                sgstRate: isIntrastate ? rate / 2 : 0,
                sgstAmount: sgst,
                igstRate: isIntrastate ? 0 : rate,
                igstAmount: igst,
                taxAmount: cgst + sgst + igst,
                total: parseFloat((taxableValue + cgst + sgst + igst).toFixed(2))
            };
        };

        const rawItems = [
            {
                description: `${booking.serviceId?.name || 'Service'} - ${booking.packageId?.name || ''} (Technician Fees)`,
                hsnSac: booking.packageId?.sacCode || booking.serviceId?.sacCode || '998700',
                quantity: 1,
                unitPrice: baseTechFee,
                taxableValue: baseTechFee,
                taxRate: 0
            },
            {
                description: `${booking.serviceId?.name || 'Service'} - ${booking.packageId?.name || ''} (Platform Fees)`,
                hsnSac: booking.packageId?.sacCode || booking.serviceId?.sacCode || '998700',
                quantity: 1,
                unitPrice: basePlatformFee,
                taxableValue: basePlatformFee,
                taxRate: 18
            }
        ];

        // 2. Add Dynamic Charges
        if (booking.appliedDynamicCharges && booking.appliedDynamicCharges.length > 0) {
            booking.appliedDynamicCharges.forEach(charge => {
                rawItems.push({
                    description: `Surcharge: ${charge.name}`,
                    hsnSac: '998700',
                    quantity: 1,
                    unitPrice: charge.amount,
                    taxableValue: charge.amount,
                    taxRate: charge.recipient === 'Technician' ? 0 : 18
                });
            });
        }

        // 3. Add Materials / Spares
        if (booking.materialsUsed && booking.materialsUsed.length > 0) {
            booking.materialsUsed.forEach(m => {
                rawItems.push({
                    description: `Spare: ${m.name} [${m.make || ''}]`,
                    hsnSac: m.hsnCode || '',
                    quantity: m.quantity || 1,
                    unitPrice: m.sellingPrice,
                    taxableValue: m.taxableValue || (m.sellingPrice * m.quantity),
                    taxRate: m.taxRate || m.sellingTaxRate || 0
                });
            });
        }

        const items = rawItems.map(processAutoItem);

        // Format address
        const addr = booking.addressId || {};
        const customerAddress = `${addr.flatNo ? addr.flatNo + ', ' : ''}${addr.building ? addr.building + ', ' : ''}${addr.street || ''}, ${addr.landmark ? addr.landmark + ', ' : ''}${addr.city || ''}, ${addr.state || ''} - ${addr.pincode || ''}`;

        const bankConfig = await Config.findOne({ key: 'bank_details' });
        const biz = bankConfig?.value || {};
        const { convertNumberToWords } = require('./numberToWords');
        const grandTotal = parseFloat((totalTaxable + totalCGST + totalSGST + totalIGST - (booking.discount || 0)).toFixed(2));

        const invoice = new Invoice({
            invoiceId,
            bookingId,
            userId: booking.userId._id,
            invoiceDate: new Date(),
            dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days due
            items,
            subtotal: parseFloat(totalTaxable.toFixed(2)),
            taxRate: 18,
            taxAmount: parseFloat((totalCGST + totalSGST + totalIGST).toFixed(2)),
            discount: booking.discount || 0,
            totalAmount: grandTotal,
            totalCGST: parseFloat(totalCGST.toFixed(2)),
            totalSGST: parseFloat(totalSGST.toFixed(2)),
            totalIGST: parseFloat(totalIGST.toFixed(2)),
            amountInWords: convertNumberToWords(grandTotal),
            placeOfSupply: buyerState || sellerState,
            stateCode: isIntrastate ? sellerStateCode : '',
            paymentStatus: (payment && payment.status === 'Paid') || booking.paymentReceived ? 'Paid' : 'Unpaid',
            paidAmount: (payment && payment.status === 'Paid') || booking.paymentReceived ? grandTotal : 0,
            paymentReference: (payment && payment.razorpayPaymentId) || booking.razorpayPaymentId || '',
            businessName: biz.accountHolderName || 'WATTORBIT ENERGY SOLUTIONS LLP',
            businessGST: biz.gstNumber || '09AAFFW4253N1ZL',
            businessPAN: biz.panNumber || 'AAFFW4253N',
            businessAddress: biz.branchName || 'Shop No.3, INDAURABAG, BKT LUCKNOW - 226201',
            bankDetails: {
                accountHolderName: biz.accountHolderName || 'WATTORBIT ENERGY SOLUTIONS LLP',
                accountNumber: biz.accountNumber || '',
                ifscCode: biz.ifscCode || '',
                bankName: biz.bankName || '',
                branchName: biz.branchName || '',
                upiId: biz.upiId || ''
            },
            customerName: booking.userId?.name || 'Customer',
            customerPhone: booking.userId?.phone || '',
            customerEmail: booking.userId?.email || '',
            customerAddress
        });

        await invoice.save();
        console.log(`Successfully auto-generated invoice ${invoiceId} for booking ${booking.bookingId}`);
        return invoice;
    } catch (err) {
        console.error('Error in autoGenerateInvoice:', err);
        return null;
    }
}

module.exports = {
    autoGenerateInvoice
};
