const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        unique: true,
        trim: true,
        sparse: true // Allows multiple null/missing values while keeping uniqueness for non-nulls
    },
    name: {
        type: String,
        trim: true
    },
    email: {
        type: String,
        lowercase: true,
        trim: true,
        default: ""
    },
    password: {
        type: String,
        required: false,
        select: false
    },
    role: {
        type: String,
        enum: ['user', 'admin', 'technician', 'engineer', 'organisation', 'employee', 'seller'],
        default: 'user'
    },
    organisationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    specialization: {
        type: String,
        enum: ['Electrician', 'Plumber', 'Carpenter', 'AC Technician', 'RO Technician', 'Pest Controller', 'House Help', 'Painter', 'Washing Machine Technician', ''],
        default: ''
    },
    city: String,
    address: String,
    phone: String,
    isApproved: {
        type: Boolean,
        default: false
    },
    fcmToken: String,
    resetPasswordToken: String,
    resetPasswordExpires: Date,
    loginOTP: String,
    loginOTPExpires: Date,
    walletBalance: {
        type: Number,
        default: 0
    },
    isPlusMember: {
        type: Boolean,
        default: false
    },
    defaultPaymentMethod: {
        type: String,
        enum: ['COD', 'Online', 'Wallet', ''],
        default: 'COD'
    },
    referralCode: {
        type: String,
        unique: true,
        sparse: true
    },
    referredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    availabilityStatus: {
        type: String,
        enum: ['Available', 'Busy', 'Offline'],
        default: 'Available'
    },
    averageRating: {
        type: Number,
        default: 5
    },
    totalRatings: {
        type: Number,
        default: 0
    },
    smsNotificationsEnabled: {
        type: Boolean,
        default: true
    },
    // Financial Details (Technician specific)
    bankAccountNo: String,
    ifscCode: String,
    aadhaarNo: String,
    panCard: String,
    upiId: String,
    financialDetailsProvided: {
        type: Boolean,
        default: false
    },
    verified: {
        type: Boolean,
        default: false
    },
    isVip: {
        type: Boolean,
        default: false
    },
    backupCodes: {
        type: [String],
        select: false
    },
    // Seller Profile Details
    sellerProfile: {
        storeName: { type: String, trim: true },
        businessType: { type: String, enum: ['Individual', 'Proprietorship', 'Partnership', 'Pvt Ltd', 'LLP', ''], default: '' },
        gstin: { type: String, trim: true, uppercase: true },
        pan: { type: String, trim: true, uppercase: true },
        pickupAddress: {
            addressLine: String,
            city: String,
            state: String,
            pincode: String,
            coordinates: { lat: Number, lng: Number }
        },
        bankDetails: {
            accountNumber: String,
            ifscCode: String,
            beneficiaryName: String,
            bankName: String
        },
        commissionRate: { type: Number, default: 10, min: 0, max: 100 },
        kycStatus: { type: String, enum: ['pending', 'submitted', 'verified', 'rejected'], default: 'pending' },
        kycRejectionReason: String,
        isActiveSeller: { type: Boolean, default: false }
    }
}, { timestamps: true });

/* =====================
   PASSWORD HASHING
===================== */
userSchema.pre('save', async function () {
    if (!this.isModified('password')) return;

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

/* =====================
   PASSWORD COMPARE
===================== */
userSchema.methods.comparePassword = async function (enteredPassword) {
    return bcrypt.compare(enteredPassword, this.password);
};

/* =====================
   TRANSFORM TO JSON (Security)
   ===================== */
userSchema.set('toJSON', {
    transform: (doc, ret) => {
        delete ret.password;
        delete ret.fcmToken;
        delete ret.resetPasswordToken;
        delete ret.resetPasswordExpires;
        delete ret.loginOTP;
        delete ret.loginOTPExpires;
        delete ret.bankAccountNo;
        delete ret.ifscCode;
        delete ret.aadhaarNo;
        delete ret.panCard;
        delete ret.upiId;
        delete ret.backupCodes;
        delete ret.__v;
        return ret;
    }
});

module.exports = mongoose.model('User', userSchema);
