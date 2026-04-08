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
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 5000;

console.log('--- Server Initializing ---');
console.log('ENV: MONGO_URI is', process.env.MONGO_URI ? 'LOADED' : 'MISSING');

/* =====================
   SECURITY MIDDLEWARE
===================== */

// 🚨 STRICT: Fail if no DB URI
if (!process.env.MONGO_URI) {
  throw new Error("❌ MONGO_URI is required in production");
}

// 🛡️ Rate Limiting (anti-spam / anti-bruteforce)
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false
}));

// 🛡️ Security Headers
app.use(helmet({
  crossOriginResourcePolicy: false,
  crossOriginEmbedderPolicy: false
}));

// 🛡️ Compression
app.use(compression());

// 🛡️ JSON limit
app.use(express.json({ limit: '10kb' }));

/* =====================
   SMART SANITIZER (EXPRESS 5 SAFE)
===================== */
const smartSanitize = (obj) => {
  if (!obj || typeof obj !== 'object') return;
  Object.keys(obj).forEach(key => {
    const val = obj[key];
    if (typeof val === 'string') {
      let clean = val.replace(/\$|\.{2,}/g, '');
      clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      clean = clean.replace(/<[^>]*on\w+\s*=.*?>/gi, '');
      obj[key] = clean;
    } else if (typeof val === 'object' && val !== null) {
      smartSanitize(val);
    }
  });
};

app.use((req, res, next) => {
  if (req.body) smartSanitize(req.body);
  if (req.params) smartSanitize(req.params);
  if (req.query) smartSanitize(req.query); // 🛡️ Safe in Express 5: Key/Value mod without object re-assignment
  next();
});

/* =====================
   TRUST PROXY & PROD CHECK
===================== */
app.set('trust proxy', 1);

if (!process.env.MONGO_URI && process.env.NODE_ENV === 'production') {
  console.error("⚠️ WARNING: MONGO_URI is missing in production environment!");
}

/* =====================
   CORS CONFIG
===================== */
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost",
  "https://wattorbit.in",
  "https://wattorbit.com",
  "https://www.wattorbit.com",
  "https://wattorbit-compliance-redressal.onrender.com",
  "https://wattorbit--website.web.app",
  "https://wattorbit--website.firebaseapp.com"
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      const normalizedOrigin = origin.toLowerCase().replace(/\/$/, "");

      const isAllowed =
        allowedOrigins.includes(normalizedOrigin) ||
        normalizedOrigin.includes(".onrender.com") ||
        normalizedOrigin.startsWith("http://localhost:") ||
        normalizedOrigin.startsWith("http://192.168.");

      if (isAllowed) {
        callback(null, true);
      } else {
        console.warn(`[CORS] Rejected: ${origin}`);
        callback(null, false);
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
  })
);

/* =====================
   STATIC ASSETS
===================== */
const imagesDir = path.join(__dirname, 'public/images');

if (require('fs').existsSync(imagesDir)) {
  console.log('✅ Serving images from:', imagesDir);
  app.use('/images', express.static(imagesDir));
} else {
  console.warn('⚠️ Static images directory NOT found.');
}

app.use('/assets', express.static(path.join(__dirname, 'assets')));

/* =====================
   REQUEST LOGGER (ANONYMIZED)
===================== */
app.use((req, res, next) => {
  const start = Date.now();

  const rawIp =
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.socket.remoteAddress ||
    'unknown';

  const ip = rawIp
    .replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)/, '$1.$2.XXX.XXX')
    .replace(/([a-f\d:]+):[a-f\d:]+:[a-f\d:]+$/, '$1:XXXX:XXXX');

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
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected: CLOUD');
  })
  .catch(err => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });

/* =====================
   HEALTH ROUTES
===================== */
app.get('/', (req, res) => {
  res.send('✅ WattOrbit Compliance API Running');
});

app.get('/api/heartbeat', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.7-secure',
    timestamp: new Date().toISOString()
  });
});

/* =====================
   DEBUG ROUTES (SAFE)
===================== */
if (process.env.NODE_ENV !== 'production') {

  app.post('/api/debug-echo', (req, res) => {
    res.json({
      message: 'Echo from server',
      body: req.body
    });
  });

  app.get('/api/debug-db', async (req, res) => {
    const Address = require('./models/Address');
    const count = await Address.countDocuments();
    res.json({ count });
  });

}

/* =====================
   API ROUTES
===================== */
app.use('/api/cities', require('./routes/cityRoutes'));
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/notifications', require('./routes/notificationHistoryRoutes'));
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

if (process.env.NODE_ENV !== 'production') {
  app.use('/api/test-notification', require('./routes/testNotificationRoutes'));
}

/* =====================
   GLOBAL ERROR HANDLER
===================== */
app.use((err, req, res, next) => {
  console.error('❌ GLOBAL ERROR:', err.message);
  console.error(err.stack); // 🔍 Show stack trace for emergency debugging

  res.status(err.status || 500).json({
    message: err.message || 'Internal server error',
    error: err.stack // 🔍 Send stack back to console during this test phase
  });
});

/* =====================
   START SERVER
===================== */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT} (BIND: 0.0.0.0)`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);

  const initCronJobs = require('./cron/scheduler');
  initCronJobs();
});