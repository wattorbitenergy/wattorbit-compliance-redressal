/**************************************************
 * FINAL server.js – WattOrbit Compliance Backend
 **************************************************/

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express = require('express');
const compression = require('compression');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

console.log('--- Server Initializing ---');
console.log('ENV: MONGO_URI is', process.env.MONGO_URI ? 'LOADED' : 'MISSING');

/* =====================
   BODY PARSER & SMART SANITIZER (EXPRESS 5 COMPATIBLE)
===================== */
app.use(express.json({ limit: '10kb' }));

// 🛡️ SECURITY: SmartSanitizer (Prevents NoSQL Injection & XSS)
// This function cleans values IN-PLACE to avoid "Read-only getter" crashes
const smartSanitize = (obj) => {
  if (!obj || typeof obj !== 'object') return;
  
  Object.keys(obj).forEach(key => {
    const val = obj[key];
    
    if (typeof val === 'string') {
      // 1. Clean NoSQL ($) and (..)
      let clean = val.replace(/\$|\.{2,}/g, '');
      // 2. Clean XSS (<script>, on*)
      clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      clean = clean.replace(/<[^>]*on\w+\s*=.*?>/gi, '');
      
      obj[key] = clean; // In-place modification is safe
    } else if (typeof val === 'object' && val !== null) {
      smartSanitize(val); // Recursive cleaning
    }
  });
};

app.use((req, res, next) => {
  if (req.body) smartSanitize(req.body);
  if (req.params) smartSanitize(req.params);
  if (req.query) smartSanitize(req.query); // 🛡️ Safe: Modifying keys inside, not re-assigning req.query
  next();
});

/* =====================
   TRUST PROXY (RENDER)
===================== */
app.set('trust proxy', 1);

/* =====================
   SECURITY HEADERS
===================== */
// Helmet temporarily disabled for troubleshooting

/* =====================
   CORS CONFIGURATION
===================== */
// ... (Lines stay as they are) ...
app.use(cors({ origin: true, credentials: true })); // 🛡️ EMERGENCY: Allow all for troubleshooting

/* =====================
   BODY PARSER & SANITIZATION (EXPRESS 5 SAFE)
===================== */
app.use(express.json({ limit: '10kb' }));

// 🛡️ SECURITY: Professional NoSQL Injection Protection (Express 5 Compatible)
const mongoSanitize = require('express-mongo-sanitize');
app.use(mongoSanitize({
  replaceWith: '_',
  allowDots: true
}));

// 🛡️ SECURITY: Manual XSS Shield (Read-only safe)
app.use((req, res, next) => {
  const sanitizeValue = (val) => {
    if (typeof val !== 'string') return val;
    return val.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  };

  const sanitizeObj = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    Object.keys(obj).forEach(key => {
      if (typeof obj[key] === 'string') {
        obj[key] = sanitizeValue(obj[key]);
      } else if (typeof obj[key] === 'object') {
        sanitizeObj(obj[key]);
      }
    });
  };

  if (req.body) sanitizeObj(req.body);
  // Note: We avoid touching req.query/req.params directly to prevent Express 5 crashes
  next();
});

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
