const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'wattorbit_super_secret_123';

// @route POST /api/auth/register
router.post('/register', async (req, res) => {
    try {
        const { username, password, role, city, phone, email } = req.body;

        // Prevent registering as admin via public API
        if (role === 'admin') {
            return res.status(403).json({ message: 'Admin registration restricted' });
        }

        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const user = new User({
            username, // Email or Phone
            password,
            role,
            city,
            phone,
            email,
            isApproved: false // Requires admin approval
        });

        await user.save();
        res.status(201).json({ message: 'Registration successful! Please wait for Admin approval.' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @route POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        if (!user.isApproved && user.role !== 'admin') {
            return res.status(403).json({ message: 'Account is pending approval. Please contact Admin.' });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { id: user._id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: {
                id: user._id,
                username: user.username,
                role: user.role,
                city: user.city,
                phone: user.phone
            }
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @route GET /api/auth/users (Admin/Engineer only)
router.get('/users', async (req, res) => {
    try {
        // In a real app, add middleware to verify Token and Admin Role here
        // For simplicity assuming the caller has a valid token which we check via headers usually
        // But here we rely on frontend protection + data filter.
        // Adding basic filtering:
        const { role } = req.query;
        const filter = {};
        if (role) filter.role = role;

        const users = await User.find(filter).select('-password');
        res.json(users);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @route PATCH /api/auth/approve/:id
router.patch('/approve/:id', async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(req.params.id, { isApproved: true }, { new: true });
        res.json(user);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// @route POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
    try {
        const { username } = req.body;
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const token = crypto.randomBytes(20).toString('hex');
        user.resetPasswordToken = token;
        user.resetPasswordExpires = Date.now() + 3600000; // 1 hour

        await user.save();

        // Send password reset email using nodemailer
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });

        // Determine recipient email (fallback to username if it looks like an email)
        const recipient = user.email || (username.includes('@') ? username : null);
        const supportEmails = ['support@wattorbit.in']; // updated to Titan SMTP email
        const toEmails = recipient ? [recipient, ...supportEmails] : supportEmails;
        if (!recipient) {
            console.warn('No email address available for password reset; token logged to console.');
            console.log(`Password reset token for ${username}: ${token}`);
        } else {
            await transporter.sendMail({
                from: process.env.SMTP_FROM || process.env.SMTP_USER,
                to: toEmails,
                subject: 'WattOrbit Password Reset Request',
                text: `You requested a password reset. Use the following token to reset your password (valid for 1 hour): ${token}`,
                html: `<p>You requested a password reset.</p><p>Use the following token to reset your password (valid for 1 hour): <b>${token}</b></p>`,
            });
        }

        // SMS notification (optional) - Fast2SMS
        if (process.env.FAST2SMS_API_KEY && process.env.WHATSAPP_ADMIN_NUMBER) {
            const axios = require('axios');
            const message = `Password reset requested for ${username}. Token: ${token}`;
            try {
                await axios.get(`https://www.fast2sms.com/dev/bulkV2`, {
                    params: {
                        authorization: process.env.FAST2SMS_API_KEY,
                        route: 'q',
                        message: message,
                        numbers: process.env.WHATSAPP_ADMIN_NUMBER.replace(/\+/g, '')
                    }
                });
            } catch (smsErr) {
                console.error('Fast2SMS notification failed:', smsErr.message);
            }
        }


        res.json({ message: 'Password reset email sent successfully.' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Middleware to verify JWT and attach user
const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'Authorization header missing' });
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Invalid token' });
    }
};

// @route PATCH /api/auth/admin-reset-password/:id
// Admin can reset any user's password
router.patch('/admin-reset-password/:id', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin privileges required' });
    }
    const { newPassword } = req.body;
    if (!newPassword) {
        return res.status(400).json({ message: 'New password is required' });
    }
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found' });
        user.password = newPassword; // pre-save hook will hash it
        await user.save();
        res.json({ message: 'Password reset by admin successful' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
