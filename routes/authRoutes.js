const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const ReferralRule = require('../models/ReferralRule');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const Config = require('../models/Config');
const mailer = require('./mailer');   // 🔥 Mailjet API (SMTP-free)
const { sendOTPSms } = require('../utils/smsHelper'); // 📱 Fast2SMS
const { sendWelcomeEmail, sendAdminAlertEmail } = require('../utils/emailHelper'); // ✉️ Email Templates
const cache = require('../utils/cache');
const { updateUniversalLedger } = require('../utils/technicianFinanceHelper');

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
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 🛡️ SECURITY: Strict limit to 5 to completely block brute-forcing
  message: { message: 'Maximum login attempts exceeded. Please try again after 15 minutes to protect your account.' }
});

/* =========================
   JWT VERIFY
========================= */
const { verifyToken } = require('../middleware/authMiddleware');

/* =========================
   PUBLIC FEATURES (Before Login)
========================= */
router.get('/public-features', async (req, res) => {
  try {
    const whitelist = ['enable_onboarding', 'ff_promo_images'];
    const configs = await Config.find({ key: { $in: whitelist } });
    const flags = {};
    configs.forEach(c => flags[c.key] = c.value);
    res.json(flags);
  } catch {
    res.status(500).json({ flags: {} });
  }
});

/* =========================
   REGISTER
========================= */
router.post('/register', authLimiter, async (req, res) => {
  try {
    let { username, password, city, phone, email, role, name, organisationId, specialization, referralCodeInput } = req.body;

    if (username !== undefined) username = String(username);
    if (phone !== undefined) phone = String(phone);
    if (email !== undefined) email = String(email);

    // Auto-generate username from phone if not provided
    if (!username && phone) {
      username = phone.trim();
    }

    username = username.toLowerCase().trim();
    if (email) email = email.toLowerCase().trim();
    if (phone) phone = phone.trim();

    // Mandatory Fields Check
    if (!phone) {
      return res.status(400).json({ message: 'Phone number is required' });
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
    const autoApprove = (safeRole === 'user') || (isAdminOrEmployee && req.body.isApproved === true);

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
        user.walletBalance += 0;
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
            // Fallback to legacy defaults (Disabled)
            user.walletBalance += 0;
            referrer.walletBalance += 0;
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

    // 📧 Admin Alert: New Registration
    sendAdminAlertEmail(
      `🆕 New ${safeRole.charAt(0).toUpperCase() + safeRole.slice(1)} Registered — ${user.name || user.username}`,
      `<div style="font-family:Arial,sans-serif;max-width:500px;padding:20px;border:1px solid #ddd;border-radius:8px;">
        <h3 style="color:#1e3a8a;">New ${safeRole.charAt(0).toUpperCase() + safeRole.slice(1)} Registration</h3>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px;font-weight:bold;">Name</td><td style="padding:6px;">${user.name || user.username}</td></tr>
          <tr style="background:#f8f9fa;"><td style="padding:6px;font-weight:bold;">Phone</td><td style="padding:6px;">${user.phone}</td></tr>
          <tr><td style="padding:6px;font-weight:bold;">Email</td><td style="padding:6px;">${user.email}</td></tr>
          <tr style="background:#f8f9fa;"><td style="padding:6px;font-weight:bold;">Role</td><td style="padding:6px;">${safeRole}</td></tr>
          <tr><td style="padding:6px;font-weight:bold;">City</td><td style="padding:6px;">${user.city || 'N/A'}</td></tr>
          <tr style="background:#f8f9fa;"><td style="padding:6px;font-weight:bold;">Status</td><td style="padding:6px;">${autoApprove ? 'Auto-Approved' : 'Pending Approval'}</td></tr>
          <tr><td style="padding:6px;font-weight:bold;">Registered At</td><td style="padding:6px;">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</td></tr>
        </table>
        <p style="margin-top:16px;"><a href="https://wattorbit.in/admin/users" style="background:#1e3a8a;color:#fff;padding:8px 16px;text-decoration:none;border-radius:6px;">View in Admin Panel</a></p>
      </div>`
    ).catch(e => console.error('[Email] Admin registration alert error:', e));

    res.status(201).json({ message: autoApprove ? 'Registered successfully' : 'Awaiting approval' });
  } catch (err) {
    console.error('[Register] Error:', err);
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
        id: user._id, // 🔥 CRITICAL FIX: Required for fetching saved addresses
        role: user.role,
        hasPassword: !!user.password,
        name: user.name,
        email: user.email,
        phone: user.phone
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
    const { username, password, fcmToken } = req.body;

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

    // 🛡️ SECURITY: Block Admin from standard login route. Must use /admin-login (2-Step).
    if (user.role === 'admin') {
      return res.status(401).json({ message: 'Admins must use the dedicated Admin Login page' });
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

    if (fcmToken) {
      user.fcmToken = fcmToken;
      await user.save();
    }

    const isWeb = req.body.platform === 'web';
    const expiresIn = '30d';

    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
        email: user.email,
        phone: user.phone,
        organisationId: user.organisationId,
        name: user.name,
        username: user.username
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
   ADMIN LOGIN (STEP 1: PASSWORD)
   Forces 2FA for all Admin roles
========================= */
router.post('/admin-login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Credentials required' });

    const identifier = String(username).toLowerCase().trim();
    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier }, { phone: String(username).trim() }]
    }).select('+password');

    if (!user || user.role !== 'admin') {
      return res.status(401).json({ message: 'Invalid admin credentials' });
    }

    if (!(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid admin credentials' });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    // Hash OTP before storing — never store plaintext OTPs
    const otpHash = await bcrypt.hash(otp, 8);
    user.loginOTP = otpHash;
    user.loginOTPExpires = Date.now() + 600000; // 10 minutes
    await user.save();

    // Send OTP via BOTH Email and SMS for admin security
    const deliveryChannels = [];

    // 📧 Email OTP
    if (user.email) {
      try {
        await mailer.sendMail({
          to: user.email,
          subject: '🔐 WattOrbit Admin Login OTP',
          html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 10px; max-width: 400px;">
              <h2 style="color: #1e3a8a;">Admin Verification</h2>
              <p>Your one-time login code is:</p>
              <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; text-align: center; margin: 15px 0;">
                <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1e3a8a;">${otp}</span>
              </div>
              <p style="color: #666; font-size: 12px;">This code expires in 10 minutes. Do not share it with anyone.</p>
              <p style="color: #999; font-size: 11px;">— WattOrbit Security</p>
            </div>
          `,
          from: "support@wattorbit.in"
        });
        deliveryChannels.push('email');
      } catch (e) {
        console.error('[Admin 2FA] Email OTP send error:', e.message);
      }
    }

    // 📱 SMS OTP
    if (user.phone) {
      try {
        await (require('../utils/smsHelper').sendOTPSms)(user.phone, otp);
        deliveryChannels.push('phone');
      } catch (e) {
        console.error('[Admin 2FA] SMS OTP send error:', e.message);
      }
    }

    console.log(`[Admin 2FA] OTP sent to ${user.username} via: ${deliveryChannels.join(', ') || 'NONE'}`);

    res.json({
      message: `First step successful. OTP sent to registered ${deliveryChannels.join(' & ')}.`,
      requires2FA: true,
      tempRef: user._id
    });
  } catch (err) {
    console.error("Admin Login Error:", err);
    res.status(500).json({ message: 'Admin login failed' });
  }
});

/* =========================
   ADMIN 2FA VERIFY (STEP 2: OTP)
   Issues 15-minute token
========================= */
router.post('/admin-verify-2fa', authLimiter, async (req, res) => {
  try {
    const { tempRef, otp } = req.body;
    if (!tempRef || !otp) return res.status(400).json({ message: 'Missing 2FA data' });

    // Fetch user with backup codes included for check
    const user = await User.findById(tempRef).select('+backupCodes +password');
    if (!user || user.role !== 'admin') return res.status(401).json({ message: 'Invalid session' });

    // 🛡️ SECURITY: Backup Code check first
    let isBackupCode = false;
    if (user.backupCodes && user.backupCodes.length > 0) {
      const bcrypt = require('bcryptjs');
      for (let i = 0; i < user.backupCodes.length; i++) {
        const match = await bcrypt.compare(otp, user.backupCodes[i]);
        if (match) {
          isBackupCode = true;
          user.backupCodes.splice(i, 1);
          user.loginOTP = undefined;
          user.loginOTPExpires = undefined;
          await user.save();
          break;
        }
      }
    }

    if (!isBackupCode) {
      const otpMatch = await bcrypt.compare(otp, user.loginOTP || '');
      if (!otpMatch || user.loginOTPExpires < Date.now()) {
        return res.status(401).json({ message: 'Invalid or expired OTP/Backup Code' });
      }
      // Clear OTP (Standard login)
      user.loginOTP = undefined;
      user.loginOTPExpires = undefined;
      await user.save();
    }

    // Issue 15-minute token
    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
        name: user.name,
        email: user.email,
        phone: user.phone,
        username: user.username
      },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    res.json({ token, user, message: isBackupCode ? 'Authenticated via Backup Code.' : 'Admin authenticated successfully.' });
  } catch (err) {
    console.error("Admin Verify 2FA Error:", err);
    res.status(500).json({ message: '2FA verification failed' });
  }
});

/* =========================
   GENERATE ADMIN BACKUP CODES
========================= */
router.post('/admin/generate-backup-codes', authLimiter, verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });

    const user = await User.findById(req.user.id).select('+backupCodes');
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Generate 10 alphanumeric codes (e.g. ABCD-1234)
    const codes = [];
    const hashedCodes = [];
    const bcrypt = require('bcryptjs');

    for (let i = 0; i < 10; i++) {
        // Generate 6-digit numeric code (XXXXXX format) for uniformity with OTP
        const plainCode = Math.floor(100000 + Math.random() * 900000).toString();
        codes.push(plainCode);
        hashedCodes.push(await bcrypt.hash(plainCode, 10));
    }

    user.backupCodes = hashedCodes;
    await user.save();

    res.json({ 
      message: 'New backup codes generated. Save these immediately as they will not be shown again.',
      codes 
    });
  } catch (err) {
    console.error('Backup code generation error:', err);
    res.status(500).json({ message: 'Failed to generate backup codes' });
  }
});


/* =========================
   SEND OTP — PHONE FIRST (New Frictionless Onboarding)
   Works for both new and returning users.
========================= */
router.post('/send-otp-phone', authLimiter, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: 'Phone number is required' });

    const cleanPhone = String(phone).replace(/\D/g, '').trim();
    if (cleanPhone.length < 10) return res.status(400).json({ message: 'Invalid phone number' });

    let user = await User.findOne({ phone: cleanPhone });
    let isNew = false;

    if (!user) {
      // Auto-create a minimal user account — name will be set after OTP
      let newReferralCode;
      let isUnique = false;
      while (!isUnique) {
        newReferralCode = crypto.randomBytes(3).toString('hex').toUpperCase();
        const existing = await User.findOne({ referralCode: newReferralCode });
        if (!existing) isUnique = true;
      }
      user = new User({
        phone: cleanPhone,
        username: `user_${cleanPhone}`,
        role: 'user',
        isApproved: true,
        name: '',
        referralCode: newReferralCode
      });
      await user.save();
      isNew = true;
    }

    // Block admins
    if (user.role === 'admin') {
      return res.status(403).json({ message: 'Admin accounts use a dedicated login page' });
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    // Hash OTP before storing — never store plaintext OTPs
    const otpHash = await bcrypt.hash(otp, 8);
    user.loginOTP = otpHash;
    user.loginOTPExpires = Date.now() + 600000; // 10 min
    await user.save();

    // 📧 Admin Alert for Frictionless Registration
    if (isNew) {
      sendAdminAlertEmail(
        `🆕 New Frictionless User — ${user.phone}`,
        `<div style="font-family:Arial,sans-serif;max-width:500px;padding:20px;border:1px solid #ddd;border-radius:8px;">
          <h3 style="color:#1e3a8a;">New Mobile Registration</h3>
          <p>A new user has registered using phone-only OTP.</p>
          <table style="width:100%;border-collapse:collapse;">
            <tr style="background:#f8f9fa;"><td style="padding:6px;font-weight:bold;">Phone</td><td style="padding:6px;">${user.phone}</td></tr>
            <tr><td style="padding:6px;font-weight:bold;">Status</td><td style="padding:6px;">Auto-Approved</td></tr>
            <tr style="background:#f8f9fa;"><td style="padding:6px;font-weight:bold;">Registered At</td><td style="padding:6px;">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</td></tr>
          </table>
          <p style="margin-top:16px;"><a href="https://wattorbit.in/admin/users" style="background:#1e3a8a;color:#fff;padding:8px 16px;text-decoration:none;border-radius:6px;">View in Admin Panel</a></p>
        </div>`
      ).catch(e => console.error('[Email] Frictionless Admin alert error:', e));
    }

    // Try both channels if available
    let smsSent = false;
    let emailSent = false;

    // 📱 Try SMS
    try {
      await sendOTPSms(cleanPhone, otp);
      smsSent = true;
    } catch (smsErr) {
      console.error('[OTP] SMS failed:', smsErr.message);
    }

    // 📧 Try Email (if user has one)
    if (user.email) {
      try {
        await mailer.sendMail({
          to: user.email,
          subject: 'WattOrbit Login OTP',
          html: `<h2>Login Verification</h2><p>Your OTP for login is: <strong>${otp}</strong></p><p>This code expires in 10 minutes.</p>`,
          from: "support@wattorbit.in"
        });
        emailSent = true;
      } catch (e) {
        console.error('[OTP] Email failed:', e.message);
      }
    }

    // Development fallback: log OTP if no delivery successful
    if (!smsSent && !emailSent) {
      console.log(`[DEV OTP] Phone: ${cleanPhone} → OTP: ${otp}`);
    }

    res.json({ message: 'OTP sent', isNew });
  } catch (err) {
    console.error('[send-otp-phone] Error:', err);
    res.status(500).json({ message: 'Failed to send OTP' });
  }
});

/* =========================
   VERIFY OTP — PHONE FIRST
========================= */
router.post('/verify-otp-phone', authLimiter, async (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) return res.status(400).json({ message: 'Phone and OTP are required' });

    const cleanPhone = String(phone).replace(/\D/g, '').trim();
    const user = await User.findOne({ phone: cleanPhone });

    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.role === 'admin') return res.status(403).json({ message: 'Admin accounts use a dedicated login page' });
    const otpMatch = await bcrypt.compare(otp, user.loginOTP || '');
    if (!otpMatch || user.loginOTPExpires < Date.now()) {
      return res.status(401).json({ message: 'Invalid or expired OTP' });
    }

    // Clear OTP
    user.loginOTP = undefined;
    user.loginOTPExpires = undefined;
    await user.save();

    const isNew = !user.name || user.name.trim() === '';

    const token = jwt.sign(
      { id: user._id, role: user.role, phone: user.phone, name: user.name },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ token, user, isNew });
  } catch (err) {
    console.error('[verify-otp-phone] Error:', err);
    res.status(500).json({ message: 'OTP verification failed' });
  }
});

/* =========================
   SEND OTP (Login) — Legacy
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

    if (user.role === 'admin') {
      return res.status(403).json({ message: 'Admin accounts cannot use standard OTP login' });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    // Hash OTP before storing — never store plaintext OTPs
    const otpHash = await bcrypt.hash(otp, 8);
    user.loginOTP = otpHash;
    user.loginOTPExpires = Date.now() + 600000; // 10 minutes
    await user.save();
    cache.del('dashboard_stats:role=admin&org=global');

    let emailSent = false;
    let smsSent = false;

    // Send OTP via email
    if (user.email) {
      try {
        await mailer.sendMail({
          to: user.email,
          subject: 'WattOrbit Login OTP',
          html: `
            <h2>Login Verification</h2>
            <p>Your OTP for login is: <strong>${otp}</strong></p>
            <p>This code expires in 10 minutes.</p>
          `,
          from: "support@wattorbit.in"
        });
        emailSent = true;
      } catch (e) {
        console.error('[OTP] Legacy Email failed:', e.message);
      }
    }

    // Send OTP via SMS
    if (user.phone) {
      try {
        await sendOTPSms(user.phone, otp);
        smsSent = true;
      } catch (e) {
        console.error('[OTP] Legacy SMS failed:', e.message);
      }
    }

    if (!emailSent && !smsSent) {
      return res.status(500).json({ message: 'Failed to deliver OTP via any registered channel' });
    }

    res.json({ message: 'OTP sent successfully' });
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

    const otpMatch = user.loginOTP && await bcrypt.compare(otp, user.loginOTP);
    if (!user || !otpMatch || user.loginOTPExpires < Date.now()) {
      return res.status(401).json({ message: 'Invalid or expired OTP' });
    }

    // 🛡️ SECURITY: Block Admin from standard OTP verification route
    if (user.role === 'admin') {
      return res.status(403).json({ message: 'Admin accounts cannot use standard OTP login' });
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
        name: user.name,
        username: user.username
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
      try {
        await mailer.sendMail({
          to: user.email,
          subject: 'WattOrbit Password Reset',
          html: `
            <h2>Password Reset</h2>
            <p>Click below to reset your password:</p>
            <a href="${resetUrl}">${resetUrl}</a>
          `
        });
      } catch (mailErr) {
        // Email failed even after retries — log it but don't crash the route.
        // The reset token is already saved, so the user could still use the link
        // if they retrieve it through another channel (e.g., SMS fallback).
        console.error('[forgot-password] Email delivery failed after retries:', mailErr.message || mailErr);
        return res.status(503).json({
          message: 'We could not send the reset email right now due to a mail server issue. Please try again in a few minutes, or contact support.'
        });
      }
    }

    res.json({ message: 'Password reset link sent to registered mail' });
  } catch (err) {
    console.error('[forgot-password] Unexpected error:', err);
    res.status(500).json({ message: 'Reset failed. Please try again.' });
  }
});

/* =========================
   SEND RESET OTP (Unified Email/Phone)
========================= */
router.post('/send-reset-otp', authLimiter, async (req, res) => {
  try {
    const { identity } = req.body;
    if (!identity) return res.status(400).json({ message: 'Email or Phone number is required' });

    const identifier = String(identity).toLowerCase().trim();
    const isEmail = identifier.includes('@');
    const cleanPhone = !isEmail ? identifier.replace(/\D/g, '') : null;

    if (!isEmail && cleanPhone.length < 10) {
      return res.status(400).json({ message: 'Invalid phone number or email' });
    }

    const query = isEmail ? { email: identifier } : { phone: cleanPhone };
    const user = await User.findOne(query);

    if (!user) return res.status(404).json({ message: 'No account found with this information' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await bcrypt.hash(otp, 8);
    user.loginOTP = otpHash;
    user.loginOTPExpires = Date.now() + 600000;
    await user.save();

    let delivered = false;
    let methodUsed = '';

    if (isEmail) {
      try {
        await mailer.sendMail({
          to: user.email,
          subject: 'WattOrbit Password Reset OTP',
          html: `<h2>Password Reset Request</h2><p>Your OTP to reset your password is: <strong style="font-size:24px;">${otp}</strong></p><p>This code expires in 10 minutes.</p>`,
          from: "support@wattorbit.in"
        });
        delivered = true;
        methodUsed = 'email';
      } catch (e) {
        console.error('[send-reset-otp] Email error:', e.message);
      }
    } else {
      try {
        await sendOTPSms(cleanPhone, otp);
        delivered = true;
        methodUsed = 'SMS';
      } catch (e) {
        console.error('[send-reset-otp] SMS error:', e.message);
      }
    }

    // Fallbacks
    if (!delivered) {
      if (!isEmail && user.email) {
        try {
          await mailer.sendMail({ to: user.email, subject: 'WattOrbit Password Reset OTP', html: `<p>Your OTP: <strong>${otp}</strong></p>` });
          delivered = true;
          methodUsed = 'email (fallback)';
        } catch (e) { console.error('[send-reset-otp] Email fallback error:', e.message); }
      } else if (isEmail && user.phone) {
        try {
          await sendOTPSms(user.phone, otp);
          delivered = true;
          methodUsed = 'SMS (fallback)';
        } catch (e) { console.error('[send-reset-otp] SMS fallback error:', e.message); }
      }
    }

    if (!delivered) console.log(`[DEV RESET OTP] ${identifier} → ${otp}`);

    res.json({ message: `OTP sent successfully via ${delivered ? methodUsed : 'development console'}` });
  } catch (err) {
    console.error('[send-reset-otp]', err);
    res.status(500).json({ message: 'Failed to send OTP. Please try again.' });
  }
});

/* =========================
   VERIFY RESET OTP & SET NEW PASSWORD
========================= */
router.post('/verify-reset-otp-password', authLimiter, async (req, res) => {
  try {
    const { identity, otp, newPassword } = req.body;
    if (!identity || !otp || !newPassword) return res.status(400).json({ message: 'Email or Phone, OTP and new password are required' });
    if (newPassword.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });

    const identifier = String(identity).toLowerCase().trim();
    const isEmail = identifier.includes('@');
    const cleanPhone = !isEmail ? identifier.replace(/\D/g, '') : null;

    const query = isEmail ? { email: identifier } : { phone: cleanPhone };
    const user = await User.findOne(query);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const otpMatch = await bcrypt.compare(otp, user.loginOTP || '');
    if (!otpMatch || !user.loginOTPExpires || user.loginOTPExpires < Date.now()) {
      return res.status(401).json({ message: 'Invalid or expired OTP. Please request a new one.' });
    }

    user.password = newPassword;
    user.loginOTP = undefined;
    user.loginOTPExpires = undefined;
    await user.save();

    res.json({ message: 'Password reset successfully. You can now login.' });
  } catch (err) {
    console.error('[verify-reset-otp-password]', err);
    res.status(500).json({ message: 'Password reset failed. Please try again.' });
  }
});

/* =========================
   RESET PASSWORD
========================= */
router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const tokenStr = String(req.body.token || '');
    if (!tokenStr) return res.status(400).json({ message: 'Reset token is required' });
    if (!req.body.newPassword || req.body.newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    const hashed = crypto.createHash('sha256').update(tokenStr).digest('hex');
    const user = await User.findOne({
      resetPasswordToken: hashed,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) return res.status(400).json({ message: 'Invalid or expired reset token' });

    user.password = req.body.newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ message: 'Password reset successful' });
  } catch (err) {
    console.error('[reset-password] Error:', err);
    res.status(500).json({ message: 'Password reset failed' });
  }
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
    if (req.user.role !== 'admin' && req.user.role !== 'employee') {
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
    if (req.user.role !== 'admin' && req.user.role !== 'employee') {
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

    // 📜 Record in Universal Ledger for audit trail
    await updateUniversalLedger(
        user._id,
        'ADJUSTMENT',
        adjustAmount,
        `ADMIN_ADJUST_${Date.now()}`,
        `Manual point adjustment by Admin (${req.user.username})`,
        { adjustedBy: req.user.id, reason: 'Manual adjustment' }
    ).catch(err => console.error('[Ledger] Manual point adjustment log error:', err));

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
    if (req.user.role !== 'admin' && req.user.role !== 'employee') {
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

// Alias for /profile used by mobile app
router.get('/profile/:userId', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select('name username email phone city role walletBalance availabilityStatus isApproved isPlusMember createdAt');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Profile fetch failed' });
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

router.patch('/set-vip/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Administrative access required' });
    }
    const { isVip } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    user.isVip = !!isVip;
    await user.save();
    res.json({ message: 'VIP status updated', isVip: user.isVip });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
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
   ADMIN: DELETE USER
========================= */
router.delete('/admin/delete-user/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'employee') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    cache.del('dashboard_stats:role=admin&org=global');
    res.json({ message: 'User successfully deleted' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ message: 'Failed to delete user' });
  }
});

/* =========================
   ADMIN: UPDATE PROFILE
   ========================= */
router.patch('/update-profile/:id', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'employee') {
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
   SELF: UPDATE OWN PROFILE
   Used by mobile app — name, city, email, password (self only)
   ========================= */
router.patch('/profile/:userId', verifyToken, async (req, res) => {
  try {
    // Users can only update their own profile
    if (req.user.id !== req.params.userId && req.user.role !== 'admin' && req.user.role !== 'employee') {
      return res.status(403).json({ message: 'Access denied: You can only update your own profile unless you are an Admin or Employee.' });
    }

    const { name, city, email, password } = req.body;
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (name !== undefined && name.trim()) {
      user.name = name.trim();
      // If username is still the auto-generated phone pattern (user_9876543210),
      // update it to the real name so it displays properly everywhere
      if (user.username && user.username.startsWith('user_') && /^user_\d+$/.test(user.username)) {
        user.username = name.trim();
      }
    }
    if (city !== undefined) user.city = city.trim();
    if (email !== undefined && email.trim()) user.email = email.toLowerCase().trim();
    if (password !== undefined && password.trim().length >= 6) {
      user.password = password.trim();
    }

    await user.save();
    res.json({ message: 'Profile updated', user });
  } catch (err) {
    console.error('[PATCH /profile] Error:', err);
    res.status(500).json({ message: 'Failed to update profile' });
  }
});

/* =========================
   UPDATE FCM TOKEN
   Mobile app sends the Firebase Cloud Messaging token after login
========================= */
router.patch('/update-fcm', verifyToken, async (req, res) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) {
      return res.status(400).json({ message: 'fcmToken is required' });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.fcmToken = fcmToken;
    await user.save();
    res.json({ message: 'FCM token updated' });
  } catch (err) {
    console.error('[update-fcm] Error:', err);
    res.status(500).json({ message: 'Failed to update FCM token' });
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
    res.json({ message: `SMS notifications ${enabled ? 'enabled' : 'disabled'}`, smsNotificationsEnabled: enabled });
  } catch (err) {
    console.error('SMS preference error:', err);
    res.status(500).json({ message: 'Failed to update SMS preference' });
  }
});

/* =========================
   UPDATE TECHNICIAN FINANCIALS
   ========================= */
router.patch('/update-technician-financials', verifyToken, async (req, res) => {
  try {
    const { bankAccountNo, ifscCode, aadhaarNo, panCard, upiId } = req.body;

    // Validate mandatory fields
    if (!bankAccountNo || !ifscCode || !aadhaarNo || !upiId) {
      return res.status(400).json({ message: 'Mandatory fields: Bank Account, IFSC, Aadhaar, and UPI ID' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.role !== 'technician' && req.user.role !== 'admin' && req.user.role !== 'employee') {
      return res.status(403).json({ message: 'Access denied: Requires Technician, Admin, or Employee role' });
    }

    user.bankAccountNo = bankAccountNo;
    user.ifscCode = ifscCode;
    user.aadhaarNo = aadhaarNo;
    user.panCard = panCard;
    user.upiId = upiId;
    user.financialDetailsProvided = true;

    await user.save();
    cache.del('dashboard_stats:role=admin&org=global');

    res.json({ message: 'Financial details updated successfully', financialDetailsProvided: true });
  } catch (err) {
    console.error('Update financials error:', err);
    res.status(500).json({ message: 'Failed to update financial details' });
  }
});

/* =========================
   ADMIN: GET TECHNICIAN FINANCIALS
   ========================= */
router.get('/admin/technician-financials/:userId', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'employee') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const user = await User.findById(req.params.userId).select('+bankAccountNo +ifscCode +aadhaarNo +panCard +upiId');
    if (!user) return res.status(404).json({ message: 'User not found' });

    res.json({
      bankAccountNo: user.bankAccountNo,
      ifscCode: user.ifscCode,
      aadhaarNo: user.aadhaarNo,
      panCard: user.panCard,
      upiId: user.upiId,
      financialDetailsProvided: user.financialDetailsProvided
    });
  } catch (err) {
    console.error('Fetch financials error:', err);
    res.status(500).json({ message: 'Failed to fetch financial details' });
  }
});

/* =========================
   ADMIN: TOGGLE USER SMS
========================= */
router.patch('/admin/toggle-sms/:userId', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'employee') {
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
