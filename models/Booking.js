const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
    bookingId: {
        type: String,
        required: true,
        unique: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    serviceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Service',
        required: true
    },
    packageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ServicePackage',
        required: true
    },
    addressId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Address',
        required: true
    },

    // Scheduling
    scheduledDate: {
        type: Date,
        required: true
    },
    scheduledTimeSlot: {
        type: String,
        required: true,
        enum: [
            '08:00 AM - 10:00 AM',
            '10:00 AM - 12:00 PM',
            '12:00 PM - 02:00 PM',
            '02:00 PM - 04:00 PM',
            '04:00 PM - 06:00 PM',
            '06:00 PM - 08:00 PM'
        ]
    },

    // Assignment
    assignedTechnician: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    assignedAt: {
        type: Date
    },

    // Status tracking
    status: {
        type: String,
        enum: [
            'Pending',
            'Confirmed',
            'Assigned',
            'In Progress',
            'Completed',
            'Cancelled',
            'Rescheduled'
        ],
        default: 'Pending'
    },

    // Pricing
    basePrice: {
        type: Number,
        required: true,
        min: 0
    },
    taxes: {
        type: Number,
        default: 0,
        min: 0
    },
    discount: {
        type: Number,
        default: 0,
        min: 0
    },
    totalAmount: {
        type: Number,
        required: true,
        min: 0
    },

    // Additional details
    customerNotes: {
        type: String,
        trim: true
    },
    technicianNotes: {
        type: String,
        trim: true
    },
    cancellationReason: {
        type: String,
        trim: true
    },
    completedAt: {
        type: Date
    },
    feedbackReminderSent: {
        type: Boolean,
        default: false
    },

    // Tracking
    statusHistory: [{
        status: {
            type: String,
            required: true
        },
        timestamp: {
            type: Date,
            default: Date.now
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        notes: {
            type: String,
            trim: true
        }
    }]
}, { timestamps: true });

// Indexes for efficient queries
bookingSchema.index({ userId: 1, status: 1 });
bookingSchema.index({ assignedTechnician: 1, status: 1 });
bookingSchema.index({ scheduledDate: 1 });
bookingSchema.index({ status: 1, createdAt: -1 });

// Add status to history before saving
bookingSchema.pre('save', async function () {
    if (this.isModified('status')) {
        this.statusHistory.push({
            status: this.status,
            timestamp: new Date(),
            notes: this.technicianNotes || this.customerNotes
        });
    }
});

module.exports = mongoose.model('Booking', bookingSchema);
