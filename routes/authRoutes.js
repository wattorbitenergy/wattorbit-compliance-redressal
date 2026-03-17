const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const ReferralRule = require('../models/ReferralRule');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const Config = require('../models/Config');
const mailer = require('./mailer');   // 🔥 Mailjet API (SMTP-free)
const { sendOTPSms } = require('../utils/smsHelper'); // 📱 Fast2SMS
const { sendWelcomeEmail } = require('../utils/emailHelper'); // ✉️ Email Templates
const cache = require('../utils/cache');

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
    let { username, password, city, phone, email, role, name, organisationId, specialization, referralCodeInput } = req.body;

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

    // Determine if password is required
    const token = req.headers.authorization?.split(' ')[1];
    let requesterRole = 'user';
    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            requesterRole = decoded.role;
        } catch (e) { /* ignore verify error here */ }
    }

    const isAdminOrEmployee = ['admin', 'employee'].includes(requesterRole);
    if (!password && !isAdminOrEmployee) {
      return res.status(400).json({ message: 'Password is required' });
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
      specialization: safeRole === 'technician' ? (specialization || req.body.specialistType || 'Electrician') : ''
    });

    // Handle Referral
    if (referralCodeInput && safeRole !== 'admin') {
      const code = referralCodeInput.toUpperCase().trim();

      // Special Promotional Code (Dynamic or Fallback to EARN50)
      const config = await Config.findOne({ key: 'default_referral_code' });
      const defaultPromoCode = (config?.value || 'EARN50').toUpperCase();

      if (code === defaultPromoCode) {
        user.walletBalance += 50;
      } else {
        const referrer = await User.findOne({ referralCode: code });
        if (referrer) {
          user.referredBy = referrer._id;

          // Fetch dynamic rule based on referee's role and specialization
          const rule = await ReferralRule.findOne({
            targetRole: safeRole,
            targetSpecialization: user.specialization || '',
            isActive: true
          });

          if (rule) {
            user.walletBalance += (rule.refereeReward || 0);
            referrer.walletBalance += (rule.referrerReward || 0);
          } else {
            // Fallback to legacy defaults
            user.walletBalance += 50;
            referrer.walletBalance += 100;
          }
          await referrer.save();
        }
      }
    }

    // Generate unique referral code for new user
    let newReferralCode;
    let isUnique = false;
    while (!isUnique) {
      newReferralCode = crypto.randomBytes(3).toString('hex').toUpperCase();
      const existing = await User.findOne({ referralCode: newReferralCode });
      if (!existing) isUnique = true;
    }
    user.referralCode = newReferralCode;

    await user.save();
    cache.del('dashboard_stats:role=admin&org=global');
    
    // 🔥 Email: Welcome — to new User
    if (autoApprove) {
      sendWelcomeEmail(user).catch(e => console.error('[Email] Welcome email error:', e));
    }

    res.status(201).json({ message: autoApprove ? 'Registered successfully' : 'Awaiting approval' });
  } catch {
    res.status(500).json({ message: 'Registration failed' });
  }
});

/* =========================
   CHECK USER (Identity First)
========================= */
router.post('/check-user', async (req, res) => {
  try {
    const { identity } = req.body;
    if (!identity) {
      return res.status(400).json({ message: 'Identity (phone or email) is required' });
    }

    const identifier = String(identity).toLowerCase().trim();
    const user = await User.findOne({
      $or: [
        { email: identifier },
        { phone: String(identity).trim() },
        { username: identifier }
      ]
    }).select('+password'); // We need to check if password exists

    if (user) {
      return res.json({
        exists: true,
        phone: user.phone,
        email: user.email,
        name: user.name,
        role: user.role,
        hasPassword: !!user.password
      });
    }

    res.json({ exists: false });
  } catch (error) {
    res.status(500).json({ message: 'Error checking user' });
  }
});

/* =========================
   LOGIN
========================= */
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username/Email/Phone and password are required' });
    }

    // Multi-Identifier Login: Username, Email, or Phone
    const identifier = String(username).toLowerCase().trim();
    const user = await User.findOne({
      $or: [
        { username: identifier },
        { email: identifier },
        { phone: String(username).trim() } // Phone is case-sensitive (usually numbers), keep original case but trim
      ]
    }).select('+password');
    
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check for passwordless users
    if (!user.password && password) {
        return res.status(401).json({ message: 'Password not set for this account. Please use OTP Login.' });
    }

    if (!(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.isApproved && user.role !== 'admin') {
      return res.status(403).json({ message: 'Pending approval' });
    }

    const isWeb = req.body.platform === 'web';
    const expiresIn = isWeb ? '1h' : '30d';

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
      { expiresIn }
    );

    res.json({ token, user });
  } catch (err) {
    console.error("Login Error ->", err);
    res.status(500).json({ message: 'Login failed' });
  }
});

/* =========================
   SEND OTP (Login)
========================= */
router.post('/send-otp', authLimiter, async (req, res) => {
  try {
    const { identity } = req.body;
    if (!identity) return res.status(400).json({ message: 'Identity required' });

    const identifier = String(identity).toLowerCase().trim();
    const user = await User.findOne({
      $or: [{ email: identifier }, { phone: String(identity).trim() }, { username: identifier }]
    });

    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!user.email) return res.status(400).json({ message: 'No email registered for this user' });

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.loginOTP = otp;
    user.loginOTPExpires = Date.now() + 600000; // 10 minutes
    await user.save();
    cache.del('dashboard_stats:role=admin&org=global');

    // Send OTP via email
    if (user.email) {
      await mailer.sendMail({
        to: user.email,
        subject: 'WattOrbit Login OTP',
        html: `
          <h2>Login Verification</h2>
          <p>Your OTP for login is: <strong>${otp}</strong></p>
          <p>This code expires in 10 minutes.</p>
        `
      });
    }

    // Send OTP via SMS (Fast2SMS - WTORBT header)
    if (user.phone) {
      await sendOTPSms(user.phone, otp);
    }

    res.json({ message: 'OTP sent' });
  } catch (error) {
    console.error('OTP Send Error:', error);
    res.status(500).json({ message: 'Failed to send OTP' });
  }
});

/* =========================
   OTP LOGIN VERIFY
========================= */
router.post('/otp-login', authLimiter, async (req, res) => {
  try {
    const { identity, otp, fcmToken } = req.body;
    if (!identity || !otp) return res.status(400).json({ message: 'Identity and OTP are required' });

    const identifier = String(identity).toLowerCase().trim();
    const user = await User.findOne({
      $or: [{ email: identifier }, { phone: String(identity).trim() }, { username: identifier }]
    });

    if (!user || user.loginOTP !== otp || user.loginOTPExpires < Date.now()) {
      return res.status(401).json({ message: 'Invalid or expired OTP' });
    }

    if (!user.isApproved && user.role !== 'admin') {
      return res.status(403).json({ message: 'Pending approval' });
    }

    // Clear OTP after use
    user.loginOTP = undefined;
    user.loginOTPExpires = undefined;
    if (fcmToken) user.fcmToken = fcmToken;
    await user.save();
    cache.del('dashboard_stats:role=admin&org=global');

    const isWeb = req.body.platform === 'web';
    const expiresIn = isWeb ? '1h' : '30d';

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
      { expiresIn }
    );

    res.json({ token, user });
  } catch (error) {
    res.status(500).json({ message: 'OTP Login failed' });
  }
});

/* =========================
   FORGOT PASSWORD (MAILJET)
========================= */
router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ message: 'Username is required' });

    const identifier = String(username).toLowerCase().trim();
    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier }, { phone: String(username).trim() }]
    });

    if (!user) return res.status(404).json({ message: 'This user is not registered' });

    const resetToken = crypto.randomBytes(20).toString('hex');
    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save();
    cache.del('dashboard_stats:role=admin&org=global');

    const origin = process.env.FRONTEND_URL || req.get('origin') || 'https://wattorbit.com';
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

    res.json({ message: 'Password reset link sent to registered mail' });
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
    const allowedRoles = ['admin', 'organisation', 'engineer', 'employee'];
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
    const users = await User.find(query).select('-password').sort({ createdAt: -1 }).lean();

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
    cache.del('dashboard_stats:role=admin&org=global');

    res.json({ message: `Password reset for ${user.username}` });
  } catch (err) {
    console.error('Admin reset password error:', err);
    res.status(500).json({ message: 'Failed to reset password' });
  }
});

/* =========================
   APPROVE USER (Admin/Org)
========================= */
router.patch('/approve/:id', verifyToken, async (req, res) => {
  try {
    const allowedRoles = ['admin', 'organisation', 'employee'];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Prevent cross-organisation approval if restricted
    if (req.user.role === 'organisation' && user.organisationId?.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Cannot approve users outside your organisation' });
    }

    user.isApproved = true;
    await user.save();
    cache.del('dashboard_stats:role=admin&org=global');

    res.json({ message: `User ${user.username} approved successfully`, user });
  } catch (err) {
    console.error('Approve user error:', err);
    res.status(500).json({ message: 'Failed to approve user' });
  }
});

/* =========================
   PUBLIC ORGANISATIONS
   Used by: Registration flow
========================= */
router.get('/public-organisations', async (req, res) => {
  try {
    const organisations = await User.find({ role: 'organisation' })
      .select('name city _id')
      .sort({ name: 1 })
      .lean();
    res.json(organisations);
  } catch (err) {
    console.error('Fetch public organisations error:', err);
    res.status(500).json({ message: 'Failed to fetch organisations' });
  }
});

/* =========================
   UPDATE PAYMENT METHOD
========================= */
router.patch('/update-payment-method', verifyToken, async (req, res) => {
  try {
    const { defaultPaymentMethod } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.defaultPaymentMethod = defaultPaymentMethod;
    await user.save();
    cache.del('dashboard_stats:role=admin&org=global');

    res.json({ message: 'Payment method updated', defaultPaymentMethod: user.defaultPaymentMethod });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update payment method' });
  }
});

/* =========================
   UPGRADE PLUS MEMBERSHIP
========================= */
router.post('/upgrade-membership', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.isPlusMember = true;
    await user.save();
    cache.del('dashboard_stats:role=admin&org=global');

    res.json({ message: 'Successfully upgraded to Plus Membership!', isPlusMember: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to upgrade membership' });
  }
});

/* =========================
   ADMIN: ADJUST USER POINTS
========================= */
router.patch('/admin/adjust-points', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const { userId, amount } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Explicitly parse and validate amount
    const adjustAmount = Number(amount);
    if (isNaN(adjustAmount)) {
      return res.status(400).json({ message: 'Invalid amount provided' });
    }

    user.walletBalance = Math.max(0, (user.walletBalance || 0) + adjustAmount);
    await user.save();
    cache.del('dashboard_stats:role=admin&org=global');

    res.json({ message: 'Points adjusted', walletBalance: user.walletBalance });
  } catch (err) {
    console.error('❌ Point Adjustment Error:', err);
    res.status(500).json({ message: 'Failed to adjust points', details: err.message });
  }
});

/* =========================
   ADMIN: TOGGLE MEMBERSHIP
========================= */
router.patch('/admin/toggle-membership', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const { userId, isPlusMember } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.isPlusMember = isPlusMember;
    await user.save();
    cache.del('dashboard_stats:role=admin&org=global');

    res.json({ message: 'Membership updated', isPlusMember: user.isPlusMember });
  } catch (err) {
    res.status(500).json({ message: 'Failed to toggle membership' });
  }
});

/* =========================
   GET REFERRAL INFO
========================= */
router.get('/referral-info', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('referralCode walletBalance');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const referralCount = await User.countDocuments({ referredBy: user._id });

    res.json({
      referralCode: user.referralCode,
      walletBalance: user.walletBalance,
      referralCount
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch referral info' });
  }
});

/* =========================
   GET PROFILE BALANCE (Lightweight Sync)
   ========================= */
router.get('/profile-balance/:userId', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('walletBalance isPlusMember');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Sync failed' });
  }
});

/* =========================
   UPDATE AVAILABILITY STATUS
   ========================= */
router.patch('/availability', verifyToken, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['Available', 'Busy', 'Offline'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.availabilityStatus = status;
    await user.save();
    cache.del('dashboard_stats:role=admin&org=global');

    res.json({ message: 'Status updated', availabilityStatus: user.availabilityStatus });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update status' });
  }
});

/* =========================
   ADMIN: SET ROLE & SPECIALIZATION
   ========================= */
router.patch('/set-role/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'organisation' && req.user.role !== 'employee') {
      return res.status(403).json({ message: 'Administrative access required' });
    }

    const { role, organisationId, specialization } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // 🛡️ SECURITY FIX: Escalation Protection
    if (req.user.role === 'organisation') {
      // Organisations can only manage their own members
      if (user.organisationId?.toString() !== req.user.id) {
        return res.status(403).json({ message: 'Access denied: User belongs to another organisation' });
      }
      // Organisations cannot promote anyone to Admin or Organisation roles
      if (role && ['admin', 'organisation'].includes(role)) {
        return res.status(403).json({ message: 'Access denied: Cannot promote to Admin/Organisation role' });
      }
    }

    if (role) user.role = role;
    if (organisationId !== undefined) user.organisationId = organisationId;
    if (specialization !== undefined) user.specialization = specialization;

    // Reset specialization if not technician
    if (user.role !== 'technician') {
        user.specialization = '';
    }

    await user.save();
    cache.del('dashboard_stats:role=admin&org=global');
    res.json({ message: 'User updated successfully', user });
  } catch (err) {
    console.error('Set role error:', err);
    res.status(500).json({ message: 'Failed to update user role' });
  }
});

/* =========================
   ADMIN: UPDATE PROFILE
   ========================= */
router.patch('/update-profile/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { name, email, phone, city, role, specialization } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (name) user.name = name;
    if (email) user.email = email;
    if (phone) user.phone = phone;
    if (city) user.city = city;
    if (role) user.role = role;
    if (specialization !== undefined) user.specialization = specialization;

    // Reset specialization if not technician
    if (user.role !== 'technician') {
        user.specialization = '';
    }

    await user.save();
    cache.del('dashboard_stats:role=admin&org=global');
    res.json({ message: 'Profile updated successfully', user });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ message: 'Failed to update profile' });
  }
});

/* =========================
   SMS PREFERENCE TOGGLE
   User can enable/disable booking SMS notifications
========================= */
router.patch('/sms-preference', verifyToken, async (req, res) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ message: '"enabled" must be a boolean' });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.smsNotificationsEnabled = enabled;
    await user.save();
    cache.del('dashboard_stats:role=admin&org=global');
    res.json({ message: `SMS notifications ${enabled ? 'enabled' : 'disabled'}`, smsNotificationsEnabled: enabled });
  } catch (err) {
    console.error('SMS preference error:', err);
    res.status(500).json({ message: 'Failed to update SMS preference' });
  }
});

/* =========================
   ADMIN: TOGGLE USER SMS
========================= */
router.patch('/admin/toggle-sms/:userId', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ message: '"enabled" must be a boolean' });
    }
    user.smsNotificationsEnabled = enabled;
    await user.save();
    cache.del('dashboard_stats:role=admin&org=global');
    res.json({ message: `SMS for ${user.name || user.username} ${enabled ? 'enabled' : 'disabled'}`, smsNotificationsEnabled: enabled });
  } catch (err) {
    console.error('Admin toggle SMS error:', err);
    res.status(500).json({ message: 'Failed to toggle SMS for user' });
  }
});

module.exports = router;
