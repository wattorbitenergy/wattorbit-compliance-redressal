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
        required: true
    },
    role: {
        type: String,
        enum: ['user', 'admin', 'technician', 'engineer', 'organisation'],
        default: 'user'
    },
    organisationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    specialization: {
        type: String,
        enum: ['Electrician', 'Plumber', 'House Help'],
        default: 'Electrician'
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
    resetPasswordExpires: Date
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

module.exports = mongoose.model('User', userSchema);
