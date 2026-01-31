const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    addressType: {
        type: String,
        enum: ['Home', 'Office', 'Other'],
        default: 'Home'
    },
    label: {
        type: String,
        trim: true,
        default: 'My Address'
    },

    // Address details
    flatNo: {
        type: String,
        trim: true
    },
    building: {
        type: String,
        trim: true
    },
    street: {
        type: String,
        required: true,
        trim: true
    },
    landmark: {
        type: String,
        trim: true
    },
    city: {
        type: String,
        required: true,
        trim: true
    },
    state: {
        type: String,
        required: true,
        trim: true
    },
    pincode: {
        type: String,
        required: true,
        trim: true
    },

    // Contact
    contactName: {
        type: String,
        trim: true
    },
    contactPhone: {
        type: String,
        trim: true
    },

    // Location
    coordinates: {
        latitude: {
            type: Number,
            min: -90,
            max: 90
        },
        longitude: {
            type: Number,
            min: -180,
            max: 180
        }
    },

    isDefault: {
        type: Boolean,
        default: false
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

// Index for efficient queries
addressSchema.index({ userId: 1, isActive: 1 });
addressSchema.index({ userId: 1, isDefault: 1 });

// Ensure only one default address per user
addressSchema.pre('save', async function (next) {
    try {
        if (this.isDefault && this.isModified('isDefault')) {
            await this.constructor.updateMany(
                { userId: this.userId, _id: { $ne: this._id } },
                { $set: { isDefault: false } }
            );
        }
        next();
    } catch (err) {
        console.error('❌ Address Pre-save Error:', err);
        next(err);
    }
});

module.exports = mongoose.model('Address', addressSchema);
