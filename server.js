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

/* =====================
   ENV CHECK (SAFE LOG)
===================== */
console.log('Environment Check:');
console.log('SMTP_HOST:', process.env.SMTP_HOST ? 'Loaded' : 'Missing');
console.log('MONGO_URI:', process.env.MONGO_URI ? 'Loaded' : 'Missing');

const app = express();
const PORT = process.env.PORT || 5000;

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
   PREFLIGHT HANDLER
===================== */
app.use(cors());


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
  .connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
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
===================== */
app.get('/', (req, res) => {
  res.send('✅ WattOrbit Compliance API Running');
});

app.get('/api/db-test', (req, res) => {
  const state = mongoose.connection.readyState;
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];

  res.json({
    status: states[state],
    dbName: mongoose.connection.name
  });
});

app.get('/api/user-check', async (req, res) => {
  try {
    const User = require('./models/User');
    const count = await User.countDocuments();
    res.json({ count });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* =====================
   API ROUTES
===================== */
app.use('/api/complaints', require('./routes/complaintRoutes'));
app.use('/api/cities', require('./routes/cityRoutes'));
app.use('/api/auth', require('./routes/authRoutes'));

/* =====================
   GLOBAL ERROR HANDLER
===================== */
app.use((err, req, res, next) => {
  console.error(err.stack);

  res.status(500).json({
    message: 'Internal server error',
    error:
      process.env.NODE_ENV === 'production'
        ? {}
        : err.message
  });
});

/* =====================
   START SERVER
===================== */
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
