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
app.use('/api/', limiter);

/* =====================
   TRUST PROXY (RENDER)
===================== */
app.set('trust proxy', 1);

/* =====================
   SECURITY HEADERS
===================== */
app.use(
  helmet({
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

/* =====================
   CORS CONFIGURATION
===================== */
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost",
  "https://localhost",
  "capacitor://localhost",
  "https://wattorbit.in",
  "https://wattorbit.com",
  "https://www.wattorbit.com",
  "https://wattorbit-compliance-redressal.onrender.com",
  "https://wattorbit-redressal.onrender.com",
  "https://wattorbit--website.web.app",
  "https://wattorbit--website.firebaseapp.com"
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      // Normalize origin: remove trailing slash
      const normalizedOrigin = origin.endsWith('/') ? origin.slice(0, -1) : origin;

      if (
        normalizedOrigin.startsWith("capacitor://") ||
        normalizedOrigin.startsWith("file://") ||
        normalizedOrigin.startsWith("http://192.168.") ||
        normalizedOrigin.startsWith("http://10.") ||
        normalizedOrigin.includes(".onrender.com") || // Allow all Render subdomains
        allowedOrigins.includes(normalizedOrigin)
      ) {
        return callback(null, true);
      }

      console.error(`❌ Blocked CORS origin: ${origin} (Normalized: ${normalizedOrigin})`);
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
  })
);

/* =====================
   BODY PARSER & SANITIZATION
===================== */
app.use(express.json());

// 🛡️ SECURITY: Custom sanitization middleware (Express 5 compatible)
// Note: req.query is read-only in Express 5, so we only sanitize req.body and req.params
const sanitizeObject = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      // Strip NoSQL operators
      obj[key] = obj[key].replace(/\$|\.{2,}/g, '');
      // Strip XSS script tags
      obj[key] = obj[key].replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      obj[key] = obj[key].replace(/<[^>]*on\w+\s*=.*?>/gi, '');
    } else if (typeof obj[key] === 'object') {
      sanitizeObject(obj[key]);
    }
  }
  return obj;
};
app.use((req, res, next) => {
  if (req.body) sanitizeObject(req.body);
  if (req.params) sanitizeObject(req.params);
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
   REQUEST LOGGER
===================== */
app.use((req, res, next) => {
  const start = Date.now();
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.socket.remoteAddress;

  res.on('finish', () => {
    // Log ALL requests for debugging
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
app.use('/api/automation', require('./routes/automationRoutes'));
app.use('/api/promotions', require('./routes/promotionRoutes'));
app.use('/api/curations', require('./routes/curationRoutes'));
app.use('/api/categories', require('./routes/categoryRoutes'));
app.use('/api/referral-rules', require('./routes/referralRuleRoutes'));
app.use('/api/work-permit', require('./routes/workPermitRoutes'));

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
