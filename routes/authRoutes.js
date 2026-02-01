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
    let { username, password, city, phone, email, role, name, organisationId, specialization } = req.body;

    // Auto-generate username from phone if not provided
    if (!username && phone) {
      username = phone.trim();
    }

    username = username.toLowerCase().trim();
    if (email) email = email.toLowerCase().trim();
    if (phone) phone = phone.trim();

    // Mandatory Fields Check
    if (!email || !phone) {
      return res.status(400).json({ message: 'Email and Phone number are required' });
    }

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
      organisationId,
      specialization: specialization || req.body.specialistType || 'Electrician'
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
    // Multi-Identifier Login: Username, Email, or Phone
    const identifier = username.toLowerCase().trim();
    const user = await User.findOne({
      $or: [
        { username: identifier },
        { email: identifier },
        { phone: username.trim() } // Phone is case-sensitive (usually numbers), keep original case but trim
      ]
    });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.isApproved && user.role !== 'admin') {
      return res.status(403).json({ message: 'Pending approval' });
    }

    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
        email: user.email,
        phone: user.phone,
        organisationId: user.organisationId,
        name: user.name
      },
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
    // Only allow specific administrative roles
    const allowedRoles = ['admin', 'organisation', 'engineer'];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: `Access denied: ${req.user.role} role not authorized for user management` });
    }

    let query = {};

    // Organisation Scoping: Scoped roles only see users belonging to them
    if (req.user.role === 'organisation' || req.user.role === 'engineer') {
      const myOrgId = req.user.organisationId || (req.user.role === 'organisation' ? req.user.id : null);

      if (myOrgId) {
        // Scoped to specific organisation
        query = { organisationId: myOrgId };
      } else if (req.user.role === 'engineer') {
        // Global Engineer sees only non-organisational users (individual staff)
        query = { organisationId: { $exists: false } };
      }
    }

    // Exclude password for security.
    const users = await User.find(query).select('-password').sort({ createdAt: -1 });

    res.json(users);
  } catch (err) {
    console.error('Fetch users error:', err);
    res.status(500).json({ message: 'Failed to fetch users' });
  }
});

/* =========================
   ADMIN RESET PASSWORD
========================= */
router.patch('/admin-reset-password/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 chars' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Directly setting password triggers pre-save hook for hashing (usually)
    user.password = newPassword;
    await user.save();

    res.json({ message: `Password reset for ${user.username}` });
  } catch (err) {
    console.error('Admin reset password error:', err);
    res.status(500).json({ message: 'Failed to reset password' });
  }
});

module.exports = router;
