/**************************************************
 * FINAL server.js – WattOrbit Compliance Backend
 **************************************************/

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express = require('express');
const compression = require('compression');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const cityRoutes = require("./routes/cityRoutes");
const notificationRoutes = require('./routes/notificationRoutes');

/* =====================
   ENV CHECK (SAFE LOG)
===================== */
console.log('Environment Check:');
console.log('MAILJET_API:', process.env.MAILJET_API_KEY ? 'Loaded' : 'Missing');
console.log('FAST2SMS_API:', process.env.FAST2SMS_API_KEY ? 'Loaded' : 'Missing');
console.log('MONGO_URI:', process.env.MONGO_URI ? 'Loaded' : 'Missing');

const app = express();
const PORT = process.env.PORT || 5000;

/* =====================
   RATE LIMITING (GLOBAL)
===================== */
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests from this IP, please try again after 15 minutes." }
});
// app.use('/api/', limiter); // 🛡️ Temporarily disabled for emergency troubleshooting

/* =====================
   TRUST PROXY (RENDER)
===================== */
app.set('trust proxy', 1);

/* =====================
   SECURITY HEADERS
===================== */
// app.use(helmet({ ... })); // 🛡️ Temporarily disabled for emergency troubleshooting

/* =====================
   CORS CONFIGURATION
===================== */
// ... (Lines stay as they are) ...
app.use(cors({ origin: true, credentials: true })); // 🛡️ EMERGENCY: Allow all for troubleshooting

/* =====================
   BODY PARSER & SANITIZATION (PROFESSIONAL PLUGINS)
===================== */
app.use(express.json({ limit: '10kb' }));

// 🛡️ SECURITY: Professional NoSQL Injection Protection
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');

app.use(mongoSanitize()); // Prevent NoSQL operator injection ($gt, etc.)
app.use(xss());           // Prevent Cross-Site Scripting (XSS)
app.use(hpp());           // Prevent HTTP Parameter Pollution

/* =====================
   STATIC ASSETS
===================== */
// Search for the images folder in common locations
// Serve images from the backend public folder (preferred for deployment)
const imagesDir = path.join(__dirname, 'public/images');
if (require('fs').existsSync(imagesDir)) {
  console.log('✅ Serving images from:', imagesDir);
  app.use('/images', express.static(imagesDir));
} else {
  // Fallback to legacy frontend path (local dev)
  const legacyDir = path.join(__dirname, '../frontend/public/images');
  if (require('fs').existsSync(legacyDir)) {
    console.log('✅ Serving images from legacy path:', legacyDir);
    app.use('/images', express.static(legacyDir));
  } else {
    console.warn('⚠️ Static images directory NOT found.');
  }
}

app.use('/assets', express.static(path.join(__dirname, 'assets')));

/* =====================
   REQUEST LOGGER (ANONYMIZZED)
===================== */
app.use((req, res, next) => {
  const start = Date.now();
  
  // 🛡️ PRIVACY: Anonymize User IP (e.g. 192.168.1.1 -> 192.168.X.X)
  const rawIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
  const ip = rawIp.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)/, '$1.$2.XXX.XXX').replace(/([a-f\d:]+):[a-f\d:]+:[a-f\d:]+$/, '$1:XXXX:XXXX');

  res.on('finish', () => {
    console.log(
      `[${new Date().toISOString()}] ${ip} ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`
    );
  });

  next();
});

/* =====================
   MONGODB CONNECTION
===================== */
const MONGO_URI =
  process.env.MONGO_URI || 'mongodb://localhost:27017/wcrm_dev';

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log(
      'MongoDB connected:',
      MONGO_URI.includes('localhost') ? 'LOCAL' : 'CLOUD'
    );
  })
  .catch(err => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });

/* =====================
   HEALTH ROUTES
==================== */
app.get('/', (req, res) => {
  res.send('✅ WattOrbit Compliance API Running');
});

/* ====================
   DEPLOYMENT HEARTBEAT
   ==================== */
app.get('/api/heartbeat', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.6-live-debug',
    timestamp: new Date().toISOString(),
    message: 'Ultimate debugging tools are active'
  });
});

// Guaranteed Public Diagnostic POST Echo
app.post('/api/debug-echo', (req, res) => {
  res.json({
    message: 'Echo from server.js',
    body: req.body,
    timestamp: new Date().toISOString()
  });
});

// Guaranteed Public Database Test
app.get('/api/debug-db', async (req, res) => {
  const Address = require('./models/Address');
  try {
    const count = await Address.countDocuments();
    res.json({ status: 'ok', count, message: 'Database connection verified from server.js' });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

/* ====================
   DIAGNOSTIC (INTERNAL)
   Disabled public access to user checks
==================== */
// app.get('/api/user-check', async (req, res) => { ... });

/* =====================
   API ROUTES
===================== */
app.use('/api/cities', require('./routes/cityRoutes'));
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/notifications', require('./routes/notificationHistoryRoutes'));

// Service Management Routes
app.use('/api/services', require('./routes/serviceRoutes'));
app.use('/api/packages', require('./routes/packageRoutes'));
app.use('/api/bookings', require('./routes/bookingRoutes'));
app.use('/api/addresses', require('./routes/addressRoutes'));
app.use('/api/payments', require('./routes/paymentRoutes'));
app.use('/api/coupons', require('./routes/couponRoutes'));
app.use('/api/invoices', require('./routes/invoiceRoutes'));
app.use('/api/feedback', require('./routes/feedbackRoutes'));
app.use('/api/finance', require('./routes/technicianFinanceRoutes'));
app.use('/api/technician-finance', require('./routes/technicianFinanceRoutes'));
app.use('/api/automation', require('./routes/automationRoutes'));
app.use('/api/promotions', require('./routes/promotionRoutes'));
app.use('/api/curations', require('./routes/curationRoutes'));
app.use('/api/categories', require('./routes/categoryRoutes'));
app.use('/api/referral-rules', require('./routes/referralRuleRoutes'));
app.use('/api/work-permit', require('./routes/workPermitRoutes'));
app.use('/api/trivia', require('./routes/triviaRoutes'));

// Production Security: Only enable test routes in non-prod
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/test-notification', require('./routes/testNotificationRoutes'));
}

/* =====================
   GLOBAL ERROR HANDLER
===================== */
app.use((err, req, res, next) => {
  // Log full error for server logs
  console.error('❌ GLOBAL ERROR:', err.message);

  // Hide stack traces in production
  res.status(err.status || 500).json({
    message: err.message || 'Internal server error',
    error: process.env.NODE_ENV === 'production' ? {} : err
  });
});

/* =====================
   START SERVER
===================== */
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);

  // Initialize Cron Jobs
  const initCronJobs = require('./cron/scheduler');
  initCronJobs();
});
