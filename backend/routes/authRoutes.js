const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const User = require('../models/User');

/* =========================
   ENV & SECURITY CHECK
========================= */
if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET not defined in environment variables');
}

const JWT_SECRET = process.env.JWT_SECRET;

/* =========================
   RATE LIMITER
========================= */
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { message: 'Too many attempts. Try again later.' }
});

/* =========================
   JWT VERIFY MIDDLEWARE
========================= */
const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ message: 'Authorization header missing' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
};

/* =========================
   REGISTER USER
========================= */
router.post('/register', async (req, res) => {
    try {
        let { username, password, role, city, phone, email } = req.body;
        username = username.toLowerCase().trim();

        if (role === 'admin') {
            return res.status(403).json({ message: 'Admin registration restricted' });
        }

        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const user = new User({
            username,
            password,
            role,
            city,
            phone,
            email,
            isApproved: false
        });

        await user.save();
        res.status(201).json({
            message: 'Registration successful. Await admin approval.'
        });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

/* =========================
   LOGIN
========================= */
router.post('/login', authLimiter, async (req, res) => {
    try {
        let { username, password } = req.body;
        username = username.toLowerCase().trim();

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        if (!user.isApproved && user.role !== 'admin') {
            return res.status(401).json({ message: 'Invalid credentials' });
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

/* =========================
   GET USERS (ADMIN / ENGINEER)
========================= */
router.get('/users', verifyToken, async (req, res) => {
    try {
        if (!['admin', 'engineer'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Access denied' });
        }

        const { role } = req.query;
        const filter = role ? { role } : {};

        const users = await User.find(filter).select('-password');
        res.json(users);

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

/* =========================
   APPROVE USER (ADMIN)
========================= */
router.patch('/approve/:id', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
    }

    try {
        const user = await User.findByIdAndUpdate(
            req.params.id,
            { isApproved: true },
            { new: true }
        ).select('-password');

        res.json(user);

    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

/* =========================
   FORGOT PASSWORD
========================= */
router.post('/forgot-password', authLimiter, async (req, res) => {
    try {
        const { username } = req.body;
        const normalized = username.toLowerCase().trim();

        const user = await User.findOne({ username: normalized });
        if (!user) {
            return res.json({ message: 'If user exists, reset instructions sent.' });
        }

        const resetToken = crypto.randomBytes(20).toString('hex');
        const hashedToken = crypto
            .createHash('sha256')
            .update(resetToken)
            .digest('hex');

        user.resetPasswordToken = hashedToken;
        user.resetPasswordExpires = Date.now() + 60 * 60 * 1000;
        await user.save();

        /* EMAIL */
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });

        if (user.email) {
            await transporter.sendMail({
                from: process.env.SMTP_FROM,
                to: user.email,
                subject: 'WattOrbit Password Reset',
                html: `
                    <p>Password reset requested.</p>
                    <p><b>Reset Token:</b> ${resetToken}</p>
                    <p>Valid for 1 hour.</p>
                `
            });
        }

        /* SMS (ADMIN ALERT) */
        if (process.env.FAST2SMS_API_KEY && process.env.WHATSAPP_ADMIN_NUMBER) {
            await axios.post(
                'https://www.fast2sms.com/dev/bulkV2',
                {
                    route: 'q',
                    message: `Password reset requested for ${normalized}`,
                    numbers: process.env.WHATSAPP_ADMIN_NUMBER.replace(/\+/g, '')
                },
                {
                    headers: {
                        authorization: process.env.FAST2SMS_API_KEY
                    }
                }
            );
        }

        res.json({ message: 'Password reset instructions sent.' });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

/* =========================
   RESET PASSWORD (TOKEN)
========================= */
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) {
            return res.status(400).json({ message: 'Token and password required' });
        }

        const hashedToken = crypto
            .createHash('sha256')
            .update(token)
            .digest('hex');

        const user = await User.findOne({
            resetPasswordToken: hashedToken,
            resetPasswordExpires: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({ message: 'Invalid or expired token' });
        }

        user.password = newPassword;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;

        await user.save();
        res.json({ message: 'Password reset successful' });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

/* =========================
   ADMIN RESET PASSWORD
========================= */
router.patch('/admin-reset-password/:id', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin privileges required' });
    }

    const { newPassword } = req.body;
    if (!newPassword) {
        return res.status(400).json({ message: 'New password required' });
    }

    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        user.password = newPassword;
        await user.save();

        res.json({ message: 'Password reset by admin successful' });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
