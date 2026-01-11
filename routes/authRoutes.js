const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const mailer = require('./mailer'); // REPLACED nodemailer with Mailjet mailer
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
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authorization header missing or invalid' });
  }

  const token = authHeader.split(' ')[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    console.error("JWT Verification Error:", err.message);
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

/* =========================
   PUBLIC: LIST ORGANISATIONS
   Used for registration dropdown
========================= */
router.get('/public-organisations', async (req, res) => {
  try {
    const orgs = await User.find({ role: 'organisation', isApproved: true })
      .select('name city username _id')
      .sort({ name: 1 });
    res.json(orgs);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch organisations' });
  }
});

/* =========================
   REGISTER USER
========================= */
router.post('/register', async (req, res) => {
  try {
    let { username, password, city, phone, email, role, name, organisationId } = req.body;

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

    // Auto-approve 'user' role (Customers). Others require vetting.
    const autoApprove = safeRole === 'user';

    const user = new User({
      username,
      name,
      password,
      email,
      city,
      phone,
      role: safeRole,
      isApproved: autoApprove,
      organisationId: organisationId || undefined
    });

    await user.save();

    res.status(201).json({
      message: autoApprove ? 'Registration successful.' : 'Registration successful. Await admin approval.'
    });

  } catch (err) {
    console.error("Register Error:", err);
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
      {
        id: user._id,
        username: user.username,
        role: user.role,
        email: user.email,     // ✅ Added email to token
        phone: user.phone,     // ✅ Added phone to token (Critical for complaint filtering)
        organisationId: user.organisationId || (user.role === 'organisation' ? user._id : undefined)
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        role: user.role,
        name: user.name,
        email: user.email,     // ✅ Exposed to frontend local storage
        phone: user.phone      // ✅ Exposed to frontend local storage (Critical for notifications)
      }
    });

  } catch {
    res.status(500).json({ message: 'Login failed' });
  }
});

/* =========================
   GET USERS (ADMIN, ENGINEER, ORG)
========================= */
router.get('/users', verifyToken, async (req, res) => {
  // Allow Admin, Engineer, and Organisation to fetch users
  const { role, id } = req.user;



  try {
    let query = {};
    if (role === 'organisation') {
      // Organisation only sees their OWN users
      query = { organisationId: id };
    }

    const users = await User.find(
      query,
      {
        username: 1,
        role: 1,
        isApproved: 1,
        createdAt: 1,
        name: 1,
        organisationId: 1
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
    // Check if target is admin (redundant as admins are auto-approved, but safe)
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found' });
    if (target.role === 'admin') return res.status(403).json({ message: 'Cannot modify system admin' });

    target.isApproved = true;
    await target.save();

    res.json({ message: 'User approved' });
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
    // Support lookup by username, email, OR phone
    const user = await User.findOne({
      $or: [
        { username: username },
        { email: username },
        { phone: username }
      ]
    });

    if (!user) {
      console.log(`Forgot Password: No user found for identifier: ${username}`);
      return res.json({ message: 'If user exists, reset instructions sent.' });
    }

    const resetToken = crypto.randomBytes(20).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = Date.now() + 60 * 60 * 1000;
    await user.save();

    /* EMAIL (NON-BLOCKING) */
    let targetEmail = user.email;

    // Fallback: If no email in profile, but the identifier looks like an email, use that
    const isEmailFormat = (str) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
    if (!targetEmail && isEmailFormat(username)) {
      console.log(`Forgot Password: Profile for ${username} has no email. Falling back to identifier as email.`);
      targetEmail = username;
    }

    if (!targetEmail) {
      console.log(`Forgot Password: User ${username} has no email address configured and identifier is not an email.`);
    } else {
      console.log(`Forgot Password: Attempting to send reset email to ${targetEmail} via Mailjet`);
      try {
        const origin = req.get('origin') || process.env.FRONTEND_URL || 'http://localhost:5173';
        const resetUrl = `${origin}/reset-password?token=${resetToken}`;

        await mailer.sendMail({
          to: targetEmail,
          subject: 'WattOrbit Password Reset Request',
          html: `
            <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #0F172A;">Password Reset</h2>
              <p>You requested a password reset for your WattOrbit ID: <b>${username}</b>.</p>
              <p>Click the button below to reset your password (valid for 1 hour):</p>
              <a href="${resetUrl}" style="display: inline-block; background-color: #2563EB; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0;">Reset Password</a>
              <p style="font-size: 12px; color: #666;">Or copy this link: <br/><a href="${resetUrl}">${resetUrl}</a></p>
              <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
              <p style="font-size: 11px; color: #999;">If you didn't request this, purely ignore this email.</p>
            </div>
          `
        });
        console.log(`Forgot Password: Reset email successfully dispatched to ${targetEmail}`);
      } catch (e) {
        console.error('Forgot Password: Mail delivery failed:', e.message);
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

    // Protect Admin
    if (user.role === 'admin') return res.status(403).json({ message: 'Cannot modify system admin' });

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
    const targetUser = await User.findById(req.params.id);
    if (!targetUser) return res.status(404).json({ message: 'User not found' });

    // Protect Admin from role change
    if (targetUser.role === 'admin') {
      return res.status(403).json({ message: 'Cannot modify system admin' });
    }

    targetUser.role = role;
    targetUser.organisationId = organisationId || undefined;
    await targetUser.save();

    res.json({
      message: 'Role updated successfully',
      user: targetUser
    });
  } catch (err) {
    res.status(400).json({ message: 'Failed to update role' });
  }
});

/* =========================
   GET PROFILE (BY ID)
========================= */
router.get('/profile/:id', verifyToken, async (req, res) => {
  const { id: requesterId, role: requesterRole } = req.user;
  const targetId = req.params.id;

  try {
    const targetUser = await User.findById(targetId).select('-password');
    if (!targetUser) return res.status(404).json({ message: 'User not found' });

    // Permission Check
    let canView = false;
    if (requesterRole === 'admin') {
      canView = true;
    } else if (requesterId === targetId) {
      canView = true;
    } else if (requesterRole === 'organisation') {
      if (targetUser.organisationId && targetUser.organisationId.toString() === requesterId) {
        canView = true;
      }
    }

    if (!canView) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(targetUser);

  } catch (err) {
    res.status(500).json({ message: 'Sync failed' });
  }
});

/* =========================
   UPDATE PROFILE (USER, ADMIN, ORG)
========================= */
router.patch('/update-profile/:id', verifyToken, async (req, res) => {
  const { id: requesterId, role: requesterRole } = req.user;
  const targetId = req.params.id;

  try {
    const targetUser = await User.findById(targetId);
    if (!targetUser) return res.status(404).json({ message: 'User not found' });

    // Permission Check
    let canUpdate = false;
    if (requesterRole === 'admin') {
      canUpdate = true;
    } else if (requesterId === targetId) {
      canUpdate = true;
    } else if (requesterRole === 'organisation') {
      // Org can only update users belonging to them
      if (targetUser.organisationId && targetUser.organisationId.toString() === requesterId) {
        canUpdate = true;
      }
    }

    if (!canUpdate) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Fields allowed to be updated
    const { name, email, phone, city } = req.body;
    if (name) targetUser.name = name;
    if (email) targetUser.email = email.toLowerCase().trim();
    if (phone) targetUser.phone = phone.trim();
    if (city) targetUser.city = city;

    await targetUser.save();

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: targetUser._id,
        username: targetUser.username,
        name: targetUser.name,
        email: targetUser.email,
        phone: targetUser.phone,
        city: targetUser.city,
        role: targetUser.role
      }
    });

  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Email or phone already in use' });
    }
    res.status(400).json({ message: 'Update failed' });
  }
});

module.exports = router;
