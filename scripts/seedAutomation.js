const mongoose = require('mongoose');
const AutomationHook = require('../models/AutomationHook');
require('dotenv').config({ path: '../.env' });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/wcrm_dev';

const hooks = [
    {
        name: 'Booking Confirmation',
        description: 'Send confirmation email and push when booking is created',
        triggerEvent: 'booking.created',
        actions: [
            {
                type: 'send_push_notification',
                config: {
                    title: 'Booking Confirmed',
                    body: 'Your booking {{bookingId}} has been received and is pending assignment.',
                    data: {
                        action: 'open_booking',
                        bookingId: '{{bookingId}}'
                    }
                }
            },
            {
                type: 'send_email',
                config: {
                    subject: 'Booking Confirmation - {{bookingId}}',
                    body: `
                        <h1>Booking Confirmed</h1>
                        <p>Hi {{userId.name}},</p>
                        <p>Your booking <strong>{{bookingId}}</strong> has been received.</p>
                        <p><strong>Service:</strong> {{serviceId.name}}</p>
                        <p><strong>Date:</strong> {{scheduledDate}}</p>
                        <p><strong>Time:</strong> {{scheduledTimeSlot}}</p>
                        <p>We will assign a technician shortly.</p>
                    `
                }
            }
        ]
    },
    {
        name: 'Technician Assigned',
        description: 'Notify user when technician is assigned',
        triggerEvent: 'booking.assigned',
        actions: [
            {
                type: 'send_push_notification',
                config: {
                    title: 'Technician Assigned',
                    body: '{{assignedTechnician.name}} has been assigned to your booking.',
                    data: {
                        action: 'open_booking',
                        bookingId: '{{bookingId}}'
                    }
                }
            },
            {
                type: 'send_email',
                config: {
                    subject: 'Technician Assigned for Booking {{bookingId}}',
                    body: `
                        <h1>Technician Assigned</h1>
                        <p>Good news! A technician has been assigned to your booking.</p>
                        <p><strong>Technician:</strong> {{assignedTechnician.name}}</p>
                        <p><strong>Phone:</strong> {{assignedTechnician.phone}}</p>
                        <p>They will arrive on {{scheduledDate}} between {{scheduledTimeSlot}}.</p>
                    `
                }
            }
        ]
    },
    {
        name: 'Payment Processing',
        description: 'Handle payment receipt actions',
        triggerEvent: 'payment.received',
        actions: [
            {
                type: 'generate_invoice',
                config: {
                    taxRate: 18
                }
            },
            {
                type: 'send_push_notification',
                config: {
                    title: 'Payment Received',
                    body: 'Thank you for your payment of ₹{{amount}}.',
                    data: {
                        action: 'view_invoice',
                        bookingId: '{{bookingId._id}}'
                    }
                }
            },
            {
                type: 'request_feedback',
                config: {},
                delay: 60 // Wait 1 minute
            },
            {
                type: 'send_email',
                config: {
                    // Send to admin - Assuming admin email is in env or hardcoded for now, or use a specific address
                    to: 'admin@wattorbit.com',
                    subject: 'Payment Received: Booking {{bookingId.bookingId}}',
                    body: `
                        <h2>Payment Received</h2>
                        <p><strong>Booking ID:</strong> {{bookingId.bookingId}}</p>
                        <p><strong>Amount:</strong> ₹{{amount}}</p>
                        <p><strong>Method:</strong> {{paymentMethod}}</p>
                        <p><strong>Transaction ID:</strong> {{transactionId}}</p>
                    `
                }
            }
        ]
    },
    {
        name: 'Feedback Notification',
        description: 'Notify admin when feedback is submitted',
        triggerEvent: 'feedback.submitted',
        actions: [
            {
                type: 'send_email',
                config: {
                    to: 'admin@wattorbit.com',
                    subject: 'New Feedback Received - {{overallRating}}/5',
                    body: `
                        <h2>New Feedback Received</h2>
                        <p><strong>Booking ID:</strong> {{bookingId}}</p>
                        <p><strong>User:</strong> {{userId.name}}</p>
                        <p><strong>Technician:</strong> {{technicianId.name}}</p>
                        <p><strong>Overall Rating:</strong> {{overallRating}}/5</p>
                        <p><strong>Review:</strong> {{review}}</p>
                    `
                }
            }
        ]
    },
    {
        name: 'Feedback Reminder',
        description: 'Remind user to submit feedback',
        triggerEvent: 'feedback.reminder',
        actions: [
            {
                type: 'send_email',
                config: {
                    subject: 'How was your service? - Booking {{bookingId}}',
                    body: `
                        <p>Hi {{userId.name}},</p>
                        <p>We see your service for booking <strong>{{bookingId}}</strong> was completed recently.</p>
                        <p>We'd love to hear your feedback!</p>
                        <p>Please open the app to rate your experience.</p>
                    `
                }
            },
            {
                type: 'send_push_notification',
                config: {
                    title: 'We value your feedback',
                    body: 'Please take a moment to rate your recent service.',
                    data: {
                        action: 'open_feedback_form',
                        bookingId: '{{_id}}'
                    }
                }
            }
        ]
    }
];

const seedHooks = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB');

        console.log('Clearing existing hooks...');
        await AutomationHook.deleteMany({});

        console.log('Seeding automation hooks...');
        await AutomationHook.insertMany(hooks);

        console.log('Successfully seeded automation hooks!');
        process.exit(0);
    } catch (err) {
        console.error('Error seeding hooks:', err);
        process.exit(1);
    }
};

seedHooks();
