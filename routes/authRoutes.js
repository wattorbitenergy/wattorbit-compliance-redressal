const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const mailer = require('./mailer');   // 🔥 Mailjet API (SMTP-free)

/* =========================
   ENV CHECK
========================= */
if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET not defined');
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
   JWT VERIFY
========================= */
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authorization header missing or invalid' });
  }

  try {
    const token = authHeader.split(' ')[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

/* =========================
   REGISTER
========================= */
router.post('/register', async (req, res) => {
  try {
    let { username, password, city, phone, email, role, name, organisationId } = req.body;
    username = username.toLowerCase().trim();
    if (email) email = email.toLowerCase().trim();
    if (phone) phone = phone.trim();

    const exists = await User.findOne({ $or: [{ username }, { email }, { phone }] });
    if (exists) return res.status(409).json({ message: 'User already exists' });

    const safeRole = role === 'admin' ? 'user' : role || 'user';
    const autoApprove = safeRole === 'user';

    const user = new User({
      username,
      password,
      email,
      city,
      phone,
      name,
      role: safeRole,
      isApproved: autoApprove,
      organisationId
    });

    await user.save();
    res.status(201).json({ message: autoApprove ? 'Registered successfully' : 'Awaiting approval' });
  } catch {
    res.status(500).json({ message: 'Registration failed' });
  }
});

/* =========================
   LOGIN
========================= */
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.isApproved && user.role !== 'admin') {
      return res.status(403).json({ message: 'Pending approval' });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role, email: user.email, phone: user.phone },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ token, user });
  } catch {
    res.status(500).json({ message: 'Login failed' });
  }
});

/* =========================
   FORGOT PASSWORD (MAILJET)
========================= */
router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const username = req.body.username.toLowerCase();
    const user = await User.findOne({
      $or: [{ username }, { email: username }, { phone: username }]
    });

    if (!user) return res.json({ message: 'If user exists, email sent.' });

    const resetToken = crypto.randomBytes(20).toString('hex');
    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save();

    const origin = req.get('origin') || process.env.FRONTEND_URL || 'https://wattorbit.com';
    const resetUrl = `${origin}/reset-password?token=${resetToken}`;

    if (user.email) {
      await mailer.sendMail({
        to: user.email,
        subject: 'WattOrbit Password Reset',
        html: `
          <h2>Password Reset</h2>
          <p>Click below to reset your password:</p>
          <a href="${resetUrl}">${resetUrl}</a>
        `
      });
    }

    res.json({ message: 'Reset instructions sent.' });
  } catch {
    res.status(500).json({ message: 'Reset failed' });
  }
});

/* =========================
   RESET PASSWORD
========================= */
router.post('/reset-password', async (req, res) => {
  const hashed = crypto.createHash('sha256').update(req.body.token).digest('hex');
  const user = await User.findOne({
    resetPasswordToken: hashed,
    resetPasswordExpires: { $gt: Date.now() }
  });

  if (!user) return res.status(400).json({ message: 'Invalid token' });

  user.password = req.body.newPassword;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  res.json({ message: 'Password reset successful' });
});

/* =========================
   GET ALL USERS (Unified Access)
   Used by: Admin User Matrix, Technician Assignment Dropdowns
========================= */
router.get('/users', verifyToken, async (req, res) => {
  try {
    // Only allow specific internal roles
    const allowedRoles = ['admin', 'organisation', 'engineer', 'technician'];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied: Internal use only' });
    }

    // specific filtering for Organisation role if needed, but for now return all
    // so the frontend can filter or show relevant data.
    // Exclude password for security.
    const users = await User.find({}).select('-password').sort({ createdAt: -1 });

    res.json(users);
  } catch (err) {
    console.error('Fetch users error:', err);
    res.status(500).json({ message: 'Failed to fetch users' });
  }
});

module.exports = router;
