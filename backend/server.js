require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');


const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());


// Log all requests
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/wattorbit_redressal';

mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
    .then(async () => {
        console.log('MongoDB connected to:', MONGO_URI.includes('localhost') ? 'LOCAL' : 'CLOUD');

        // Auto-create admin on startup for environments without shell access
        try {
            const User = require('./models/User');
            const adminUsername = process.env.ADMIN_USERNAME || 'admin';
            const existingAdmin = await User.findOne({ username: adminUsername });

            if (!existingAdmin) {
                if (process.env.ADMIN_PASSWORD) {
                    const admin = new User({
                        username: adminUsername,
                        password: process.env.ADMIN_PASSWORD,
                        role: 'admin',
                        isApproved: true
                    });
                    await admin.save();
                    console.log('Admin user auto-created successfully.');
                }
            } else if (process.env.ADMIN_PASSWORD) {
                // Update existing admin password to match current environment variable
                existingAdmin.password = process.env.ADMIN_PASSWORD;
                await existingAdmin.save();
                console.log('Admin password updated to match environment variables.');
            }
        } catch (adminErr) {
            console.error('Admin auto-creation failed:', adminErr.message);
        }
    })
    .catch(err => console.error('MongoDB connection error:', err));

// Routes Placeholder
app.get('/', (req, res) => {
    res.send('Wattorbit Compliance API Running');
});

// Database Status Route
app.get('/api/db-test', (req, res) => {
    const state = mongoose.connection.readyState;
    const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    res.json({
        status: states[state],
        dbName: mongoose.connection.name,
        uri_length: MONGO_URI.length
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

app.get('/api/auth/debug-users', async (req, res) => {
    try {
        const User = require('./models/User');
        const users = await User.find().select('username role isApproved');
        res.json(users);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Import Routes
const complaintRoutes = require('./routes/complaintRoutes');
const cityRoutes = require('./routes/cityRoutes');
const authRoutes = require('./routes/authRoutes');

app.use('/api/complaints', complaintRoutes);
app.use('/api/cities', cityRoutes);
app.use('/api/auth', authRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        message: 'Something went wrong!',
        error: process.env.NODE_ENV === 'production' ? {} : err.stack
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

