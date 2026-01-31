/**************************************************
 * FINAL server.js – WattOrbit Compliance Backend
 **************************************************/

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express = require('express');
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
  "http://localhost",
  "https://localhost",
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
      if (
        !origin || // Android, Postman, server-to-server
        origin.startsWith("capacitor://") ||
        origin.startsWith("file://") ||
        origin.startsWith("http://192.168.") ||
        origin.startsWith("http://10.") ||
        allowedOrigins.includes(origin)
      ) {
        return callback(null, true);
      }

      console.error("❌ Blocked CORS origin:", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
  })
);

/* =====================
   BODY PARSER
===================== */
app.use(express.json());

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
    version: '1.0.5-debug',
    timestamp: new Date().toISOString(),
    message: 'Latest debugging tools are active'
  });
});

/* ====================
   DIAGNOSTIC (INTERNAL)
   Disabled public access to user checks
==================== */
// app.get('/api/user-check', async (req, res) => { ... });

/* =====================
   API ROUTES
===================== */
app.use('/api/complaints', require('./routes/complaintRoutes'));
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
app.use('/api/invoices', require('./routes/invoiceRoutes'));
app.use('/api/feedback', require('./routes/feedbackRoutes'));
app.use('/api/automation', require('./routes/automationRoutes'));

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
