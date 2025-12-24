require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 5000;

/* =====================
   MIDDLEWARE
===================== */
app.use(helmet());

app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
}));

app.use(express.json());

/* =====================
   REQUEST LOGGER
===================== */
app.use((req, res, next) => {
    const start = Date.now();
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

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
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/wattorbit_redressal';

mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
    .then(async () => {

// TEMPORARY ADMIN PASSWORD SYNC (REMOVE AFTER FIX)
const User = require('./models/User');
const adminUsername = process.env.ADMIN_USERNAME || 'admin';

const admin = await User.findOne({ username: adminUsername });

if (admin && process.env.ADMIN_PASSWORD) {
    admin.password = process.env.ADMIN_PASSWORD;
    await admin.save();
    console.log('Admin password force-reset from env (temporary)');
}
        console.log('MongoDB connected to:', MONGO_URI.includes('localhost') ? 'LOCAL' : 'CLOUD');

        /* =====================
           ADMIN AUTO-CREATION
        ===================== */
        try {
            const User = require('./models/User');
            const adminUsername = process.env.ADMIN_USERNAME || 'admin';

            const adminExists = await User.findOne({ username: adminUsername });

            if (!adminExists && process.env.ADMIN_PASSWORD) {
                await User.create({
                    username: adminUsername,
                    password: process.env.ADMIN_PASSWORD,
                    role: 'admin',
                    isApproved: true
                });
                console.log('Admin user auto-created successfully.');
            } else {
                console.log('Admin user already exists.');
            }
        } catch (adminErr) {
            console.error('Admin auto-creation failed:', adminErr.message);
        }
    })
    .catch(err => {
        console.error('MongoDB connection error:', err.message);
        process.exit(1);
    });

/* =====================
   ROUTES
===================== */
app.get('/', (req, res) => {
    res.send('WattOrbit Compliance API Running');
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
   IMPORT ROUTES
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
        error: process.env.NODE_ENV === 'production' ? {} : err.stack
    });
});

/* =====================
   START SERVER
===================== */
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
