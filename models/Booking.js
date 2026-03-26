const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
    bookingId: {
        type: String,
        required: false,
        unique: true,
        sparse: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    organisationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
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
            'Awaiting Confirmation',
            'Pending',
            'Confirmed',
            'Assigned',
            'Started',
            'In Progress',
            'Completed',
            'Cancelled',
            'Rescheduled'
        ],
        default: 'Pending'
    },
    serviceOTP: String,
    serviceOTPExpires: Date,

    // Pricing
    basePrice: {
        type: Number,
        required: true,
        min: 0
    },
    technicianCharges: {
        type: Number,
        default: 0,
        min: 0
    },
    platformFees: {
        type: Number,
        default: 0,
        min: 0
    },
    taxes: {
        type: Number,
        default: 0,
        min: 0
    },
    couponId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Coupon'
    },
    couponCode: {
        type: String,
        uppercase: true,
        trim: true
    },
    discount: {
        type: Number,
        default: 0,
        min: 0
    },
    technicianDiscountShare: {
        type: Number,
        default: 0,
        min: 0
    },
    platformDiscountShare: {
        type: Number,
        default: 0,
        min: 0
    },
    lineItemDiscount: {
        type: Number,
        default: 0,
        min: 0
    },
    pointsUsed: {
        type: Number,
        default: 0,
        min: 0
    },
    totalAmount: {
        type: Number,
        required: true,
        min: 0
    },
    appliedDynamicCharges: [{
        name: String,
        amount: Number,
        recipient: { type: String, enum: ['Platform', 'Technician'] }
    }],

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
    paymentReceived: {
        type: Boolean,
        default: false
    },
    paymentMethod: {
        type: String,
        enum: ['COD', 'Online', 'Wallet', 'Mixed'],
        default: 'COD'
    },
    razorpayOrderId: {
        type: String,
        trim: true
    },
    razorpayPaymentId: {
        type: String,
        trim: true
    },
    razorpaySignature: {
        type: String,
        trim: true
    },
    customerBehavior: {
        type: String,
        enum: ['Excellent', 'Good', 'Neutral', 'Difficult', 'Abusive'],
        default: 'Neutral'
    },
    userRating: {
        type: Number,
        min: 0,
        max: 5,
        default: 0
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
    }],

    // Multi-Service Support (Line Items)
    services: [{
        serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service' },
        packageId: { type: mongoose.Schema.Types.ObjectId, ref: 'ServicePackage' },
        name: { type: String, required: true },
        basePrice: { type: Number, required: true },
        technicianCharges: { type: Number, default: 0 },
        platformFees: { type: Number, default: 0 },
        discount: { type: Number, default: 0 },
        finalPrice: { type: Number, required: true },
        isAdditional: { type: Boolean, default: false },
        addedAt: { type: Date, default: Date.now }
    }],

    paymentStatus: {
        type: String,
        enum: ['unpaid', 'paid', 'partially_paid'],
        default: 'unpaid'
    },
    paymentId: String, // Trx ID for UPI/Wallet
    
    // Technician Job Photos
    jobPhotos: {
        start: [String],
        progress: [String],
        completion: [String]
    }
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

    // Sync legacy serviceId/packageId for backward compatibility (if first service exists)
    if (this.services && this.services.length > 0 && !this.serviceId) {
        this.serviceId = this.services[0].serviceId;
        this.packageId = this.services[0].packageId;
        this.basePrice = this.services[0].basePrice;
    }
});

module.exports = mongoose.model('Booking', bookingSchema);
