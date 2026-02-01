const Invoice = require('../models/Invoice');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const { generateInvoiceId } = require('./idGenerator');

/**
 * Automatically generate an invoice for a booking if one doesn't exist
 * @param {String} bookingId - The ID of the booking
 * @returns {Promise<Object|null>} - The generated invoice or null if failed/exists
 */
async function autoGenerateInvoice(bookingId) {
    try {
        // Check if invoice already exists
        const existingInvoice = await Invoice.findOne({ bookingId });
        if (existingInvoice) {
            console.log(`Invoice already exists for booking ${bookingId}`);
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
            dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days due
            items,
            subtotal: booking.basePrice,
            taxRate: 18,
            taxAmount: booking.taxes || 0,
            discount: booking.discount || 0,
            totalAmount: booking.totalAmount,
            paymentStatus: (payment && payment.status === 'Paid') || booking.paymentReceived ? 'Paid' : 'Unpaid',
            paidAmount: (payment && payment.status === 'Paid') || booking.paymentReceived ? booking.totalAmount : 0,
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
