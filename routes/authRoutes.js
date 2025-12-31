const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const User = require('../models/User');

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
   JWT VERIFY MIDDLEWARE
========================= */
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: 'Authorization header missing' });
  }

  const token = authHeader.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

/* =========================
   REGISTER USER
========================= */
router.post('/register', async (req, res) => {
  try {
    let { username, password, city, phone, email, role, name } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    username = username.toLowerCase().trim();
    if (email) email = email.toLowerCase().trim();
    if (phone) phone = phone.trim();

    // Check for existing user by username, email, OR phone
    // We want to prevent re-registration if email or phone is already taken
    const existingUser = await User.findOne({
      $or: [
        { username },
        { email: email || "non-existent-email-placeholder" },
        { phone: phone || "non-existent-phone-placeholder" }
      ]
    });

    if (existingUser) {
      if (existingUser.username === username) return res.status(409).json({ message: 'Username already taken' });
      if (email && existingUser.email === email) return res.status(409).json({ message: 'Email already registered' });
      if (phone && existingUser.phone === phone) return res.status(409).json({ message: 'Phone number already registered' });
      return res.status(409).json({ message: 'User already exists' });
    }

    // Security: Do not allow 'admin' registration via public API.
    const safeRole = (role === 'admin') ? 'user' : (role || 'user');

    const user = new User({
      username,
      name,
      password,
      email,
      city,
      phone,
      role: safeRole,
      isApproved: false
    });

    await user.save();

    res.status(201).json({
      message: 'Registration successful. Await admin approval.'
    });

  } catch (err) {
    res.status(500).json({ message: 'Registration failed' });
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
      return res.status(403).json({ message: 'Account pending admin approval' });
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
        role: user.role
      }
    });

  } catch {
    res.status(500).json({ message: 'Login failed' });
  }
});

/* =========================
   GET USERS (ADMIN & ENGINEER)
========================= */
router.get('/users', verifyToken, async (req, res) => {
  // Allow Admin AND Engineer to fetch users (Engineers need to find Technicians)
  if (req.user.role !== 'admin' && req.user.role !== 'engineer') {
    return res.status(403).json({ message: 'Access denied' });
  }

  try {
    const users = await User.find(
      {},
      {
        username: 1,
        role: 1,
        isApproved: 1,
        createdAt: 1
      }
    ).sort({ createdAt: -1 });

    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch users' });
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
  } catch {
    res.status(400).json({ message: 'Approval failed' });
  }
});

/* =========================
   FORGOT PASSWORD
========================= */
router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const username = req.body.username?.toLowerCase().trim();
    const user = await User.findOne({ username });

    if (!user) {
      return res.json({ message: 'If user exists, reset instructions sent.' });
    }

    const resetToken = crypto.randomBytes(20).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = Date.now() + 60 * 60 * 1000;
    await user.save();

    /* EMAIL (NON-BLOCKING) */
    if (user.email && process.env.SMTP_HOST) {
      try {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT),
          secure: Number(process.env.SMTP_PORT) === 465, // Auto-detect secure based on port
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          },
          tls: { rejectUnauthorized: false }
        });

        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: user.email,
          subject: 'WattOrbit Password Reset',
          text: `Reset Token: ${resetToken} (valid 1 hour)`
        });
      } catch (e) {
        console.error('SMTP failed:', e.message);
      }
    }

    res.json({ message: 'Password reset instructions sent.' });

  } catch {
    res.status(500).json({ message: 'Password reset failed' });
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

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

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

  } catch {
    res.status(500).json({ message: 'Password reset failed' });
  }
});

/* =========================
   ADMIN RESET PASSWORD
========================= */
router.patch('/admin-reset-password/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin privileges required' });
  }

  if (!req.body.newPassword) {
    return res.status(400).json({ message: 'New password required' });
  }

  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.password = req.body.newPassword;
    await user.save();

    res.json({ message: 'Password reset by admin successful' });
  } catch {
    res.status(500).json({ message: 'Admin reset failed' });
  }
});
/* =========================
   SET USER ROLE (ADMIN ONLY)
========================= */
router.patch('/set-role/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }

  const { role, organisationId } = req.body;

  const allowedRoles = ['user', 'engineer', 'technician', 'organisation'];

  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ message: 'Invalid role' });
  }

  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role, organisationId: organisationId || undefined },
      { new: true }
    ).select('-password');

    res.json({
      message: 'Role updated successfully',
      user
    });
  } catch (err) {
    res.status(400).json({ message: 'Failed to update role' });
  }
});

module.exports = router;
