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

        const items = [
            {
                description: `${booking.serviceId.name} - ${booking.packageId.name} (Technician Fees)`,
                quantity: 1,
                unitPrice: baseTechFee,
                taxableValue: baseTechFee,
                taxRate: 0,
                taxAmount: 0,
                total: baseTechFee
            },
            {
                description: `${booking.serviceId.name} - ${booking.packageId.name} (Platform Fees)`,
                quantity: 1,
                unitPrice: basePlatformFee,
                taxableValue: basePlatformFee,
                taxRate: 18,
                taxAmount: booking.taxes || 0, // Use the pre-calculated taxes from booking
                total: basePlatformFee + (booking.taxes || 0)
            }
        ];

        // 2. Add Dynamic Charges
        if (booking.appliedDynamicCharges && booking.appliedDynamicCharges.length > 0) {
            booking.appliedDynamicCharges.forEach(charge => {
                items.push({
                    description: `Surcharge: ${charge.name}`,
                    quantity: 1,
                    unitPrice: charge.amount,
                    taxableValue: charge.amount,
                    taxRate: charge.recipient === 'Technician' ? 0 : 18,
                    taxAmount: 0, // Simplified for surcharges as they are usually small
                    total: charge.amount
                });
            });
        }

        // 3. Add Materials / Spares
        if (booking.materialsUsed && booking.materialsUsed.length > 0) {
            booking.materialsUsed.forEach(m => {
                items.push({
                    description: `Spare: ${m.name} [${m.make}]`,
                    quantity: m.quantity,
                    unitPrice: m.sellingPrice,
                    taxableValue: m.taxableValue || (m.sellingPrice * m.quantity),
                    taxRate: m.taxRate || 0,
                    taxAmount: m.taxAmount || 0,
                    total: m.totalLineAmount
                });
            });
        }

        // Format address
        const addr = booking.addressId;
        const customerAddress = `${addr.flatNo ? addr.flatNo + ', ' : ''}${addr.building ? addr.building + ', ' : ''}${addr.street}, ${addr.landmark ? addr.landmark + ', ' : ''}${addr.city}, ${addr.state} - ${addr.pincode}`;

        const bankConfig = await Config.findOne({ key: 'bank_details' });
        const biz = bankConfig?.value || {};

        const invoice = new Invoice({
            invoiceId,
            bookingId,
            userId: booking.userId._id,
            invoiceDate: new Date(),
            dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days due
            items,
            subtotal: booking.basePrice + (booking.materialTotal || 0),
            taxRate: 18,
            taxAmount: (booking.taxes || 0) + (booking.materialTaxTotal || 0),
            discount: booking.discount || 0,
            totalAmount: booking.totalAmount,
            paymentStatus: (payment && payment.status === 'Paid') || booking.paymentReceived ? 'Paid' : 'Unpaid',
            paidAmount: (payment && payment.status === 'Paid') || booking.paymentReceived ? booking.totalAmount : 0,
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
            customerName: booking.userId.name,
            customerPhone: booking.userId.phone,
            customerEmail: booking.userId.email,
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
