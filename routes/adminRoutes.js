const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Booking = require('../models/Booking');
const Config = require('../models/Config');
const mailer = require('./mailer');
const jwt = require('jsonwebtoken');

// Verify token middleware
const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authorization header missing or invalid' });
    }

    const token = authHeader.split(' ')[1];
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
};

/* =================================================================
   POST: SEND WEEKLY SUMMARY MANUALLY (ADMIN ONLY)
   Body: { targetEmails: ["email1@test.com", "email2@test.com"] }
   Use case: Admin selects users/orgs from UI and clicks "Send Summary"
   ================================================================= */
router.post('/send-weekly-summary', verifyToken, async (req, res) => {
    const { role } = req.user;
    const { targetEmails } = req.body;

    if (role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
    }

    if (!targetEmails || !Array.isArray(targetEmails) || targetEmails.length === 0) {
        return res.status(400).json({ message: 'Target emails required' });
    }

    try {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 7);

        // Process each email individually to respect data privacy scopes
        const results = await Promise.allSettled(targetEmails.map(async (email) => {
            // 1. Find the User Identity
            const user = await User.findOne({ email });
            if (!user) {
                console.warn(`Summary Skipped: No user found for email ${email}`);
                return;
            }

            // 2. Build Query Based on Role (Scope Logic)
            let query = { createdAt: { $gte: start, $lte: end } };

            if (user.role === 'organisation') {
                // Organisation: Only see bookings belonging to their organisation
                query.organisationId = user._id;
            } else if (user.role === 'technician') {
                // Technician: Only see bookings assigned to them
                query.assignedTechnician = user._id;
            } else if (user.role === 'user') {
                // User: Only see their own bookings
                query.userId = user._id;
            }
            // Admin/Engineer: See ALL bookings (default query)

            // 3. Fetch Data
            const bookings = await Booking.find(query)
                .populate('serviceId', 'name')
                .populate('packageId', 'name')
                .sort({ createdAt: -1 });

            // 4. Generate Stats
            const total = bookings.length;
            const resolved = bookings.filter(b => b.status === 'Completed').length;
            const pending = bookings.filter(b => ['Pending', 'Confirmed', 'Assigned'].includes(b.status)).length;
            const inProgress = bookings.filter(b => b.status === 'In Progress').length;

            // 5. Build HTML
            const summaryHtml = `
              <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 10px; max-width: 600px;">
                <h2 style="color: #1e3a8a;">WattOrbit - Weekly Booking Summary</h2>
                <p style="color: #555;">Hello <b>${user.username}</b>,</p>
                <p style="color: #555;">Here is the overview of booking activity relevant to your account for the week of <b>${start.toLocaleDateString()} to ${end.toLocaleDateString()}</b>.</p>
                
                <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                  <tr style="background-color: #f3f4f6;">
                    <th style="padding: 10px; border: 1px solid #ddd;">Total Bookings</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">Completed</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">Pending</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">In Progress</th>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #ddd; text-align: center; font-weight: bold;">${total}</td>
                    <td style="padding: 10px; border: 1px solid #ddd; text-align: center; color: green;">${resolved}</td>
                    <td style="padding: 10px; border: 1px solid #ddd; text-align: center; color: red;">${pending}</td>
                    <td style="padding: 10px; border: 1px solid #ddd; text-align: center; color: orange;">${inProgress}</td>
                  </tr>
                </table>
        
                <h3 style="margin-top: 20px; color: #333;">Recent Highlights:</h3>
                <ul style="color: #555; font-size: 13px;">
                  ${bookings.length > 0
                    ? bookings.slice(0, 5).map(b => `<li><b>${b.bookingId}</b>: ${b.status} (${b.serviceId?.name || 'Service'})</li>`).join('')
                    : '<li>No activity recorded this week.</li>'
                }
                </ul>
                ${bookings.length > 5 ? `<p style="font-size: 12px; color: #888;">+ ${bookings.length - 5} more bookings...</p>` : ''}
                
                <p style="margin-top: 30px; font-size: 12px; color: #999;">This report was generated manually by the Admin Team.</p>
              </div>
            `;

            // 6. Send Email
            await mailer.sendMail({
                to: email,
                subject: `Weekly Summary Report (${start.toLocaleDateString()} - ${end.toLocaleDateString()})`,
                html: summaryHtml
            });

            // Summary sent to user
        }));

        res.json({ message: `Processing completed for ${targetEmails.length} recipients.` });

    } catch (err) {
        console.error('Summary Email Error:', err);
        res.status(500).json({ message: 'Failed to send summary emails' });
    }
});

/* =================================================================
   GET/SET CONFIG (ADMIN ONLY)
   ================================================================= */
router.get('/config/:key', verifyToken, async (req, res) => {
    try {
        const config = await Config.findOne({ key: req.params.key });
        res.json(config || { key: req.params.key, value: false });
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch config' });
    }
});

router.post('/config', verifyToken, async (req, res) => {
    const allowedRoles = ['admin', 'employee'];
    if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ message: 'Administrative access required' });
    }

    const { key, value } = req.body;
    try {
        const config = await Config.findOneAndUpdate(
            { key },
            { value },
            { upsert: true, new: true }
        );
        res.json(config);
    } catch (err) {
        res.status(500).json({ message: 'Failed to update config' });
    }
});

/* =================================================================
   POST: UPLOAD NEW IMAGE (ADMIN ONLY)
   Accepts single image up to 100KB, saved to public/images
   ================================================================= */
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dest = path.join(__dirname, '../public/images');
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        cb(null, dest);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-]/g, ''));
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 }, // 100KB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only image files are allowed!'));
    }
});

router.post('/upload-image', verifyToken, (req, res) => {
    const allowedRoles = ['admin', 'employee'];
    if (!allowedRoles.includes(req.user.role)) return res.status(403).json({ message: 'Administrative access required' });

    upload.single('image')(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ message: 'File too large. Max size is 100KB.' });
            return res.status(500).json({ message: err.message });
        } else if (err) {
            return res.status(400).json({ message: err.message });
        }

        if (!req.file) return res.status(400).json({ message: 'Please upload a file' });

        res.json({
            message: 'Image uploaded successfully',
            name: req.file.filename,
            url: `/images/${req.file.filename}`
        });
    });
});

/* =================================================================
   GET: LIST ALL UPLOADED IMAGES (ADMIN ONLY)
   Reads frontend/public/images and returns filenames
   ================================================================= */
router.get('/images', verifyToken, async (req, res) => {
    const allowedRoles = ['admin', 'employee'];
    if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ message: 'Administrative access required' });
    }

    const fs = require('fs');
    const path = require('path');

    // Priority: 1. backend/public/images, 2. frontend/public/images
    const potentialPaths = [
        path.join(__dirname, '../public/images'),
        path.join(__dirname, '../../frontend/public/images'),
        path.join(process.cwd(), 'public/images'),
        path.join(process.cwd(), 'frontend/public/images')
    ];

    const imagesDir = potentialPaths.find(p => fs.existsSync(p) && fs.lstatSync(p).isDirectory());

    try {
        if (!imagesDir) {
            console.error('Admin Images: Images folder not found.');
            return res.json([]);
        }

        const files = fs.readdirSync(imagesDir);
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico'];

        const images = files
            .filter(file => imageExtensions.includes(path.extname(file).toLowerCase()))
            .map(file => ({
                name: file,
                url: `/images/${file}`
            }));

        res.json(images);
    } catch (err) {
        console.error('Error reading images directory:', err);
        res.status(500).json({ message: 'Failed to list images' });
    }
});

module.exports = router;
