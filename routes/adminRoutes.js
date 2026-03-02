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

            console.log(`Summary sent to ${email} (${user.role}) - ${total} tickets found.`);
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
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
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
   GET: DIAGNOSTIC (ADMIN ONLY)
   ================================================================= */
router.get('/path-check', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });

    const fs = require('fs');
    const path = require('path');

    const results = {
        cwd: process.cwd(),
        dirname: __dirname,
        root_dir: path.join(__dirname, '../..'),
        found_folders: []
    };

    try {
        const root = path.join(__dirname, '../..');
        results.root_content = fs.existsSync(root) ? fs.readdirSync(root) : 'Not found';

        const cwd = process.cwd();
        results.cwd_content = fs.existsSync(cwd) ? fs.readdirSync(cwd) : 'Not found';

        const parentCwd = path.join(cwd, '..');
        results.parent_cwd_content = fs.existsSync(parentCwd) ? fs.readdirSync(parentCwd) : 'Not found';

        // Scan for images anywhere relative to root
        const potential = [
            path.join(root, 'frontend/public/images'),
            path.join(root, 'public/images'),
            path.join(cwd, '../frontend/public/images'),
            path.join(cwd, 'frontend/public/images'),
            path.join(cwd, 'public/images'),
            '/opt/render/project/src/frontend/public/images',
            '/opt/render/project/src/public/images'
        ];

        potential.forEach(p => {
            results.found_folders.push({ path: p, exists: fs.existsSync(p) });
        });

        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* =================================================================
   GET: LIST ALL UPLOADED IMAGES (ADMIN ONLY)
   Reads frontend/public/images and returns filenames
   ================================================================= */
router.get('/images', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
    }

    const fs = require('fs');
    const path = require('path');

    // 1. Define common locations
    const searchDirs = [
        path.join(__dirname, '../../frontend/public/images'),
        path.join(process.cwd(), 'frontend/public/images'),
        path.join(process.cwd(), 'public/images'),
        path.join(process.cwd(), '../frontend/public/images'),
        path.join(__dirname, '../public/images'),
        '/opt/render/project/src/frontend/public/images'
    ];

    let imagesDir = searchDirs.find(d => fs.existsSync(d) && fs.lstatSync(d).isDirectory());

    // 2. Aggressive search if still not found
    if (!imagesDir) {
        console.log('Admin Images Debug - Starting Aggressive Search');
        const root = process.cwd();
        const findInDir = (currentDir, depth = 0) => {
            if (depth > 3) return null;
            try {
                const items = fs.readdirSync(currentDir);
                for (const item of items) {
                    if (['node_modules', '.git', 'dist', 'build'].includes(item)) continue;
                    const fullPath = path.join(currentDir, item);
                    if (fs.lstatSync(fullPath).isDirectory()) {
                        if (item === 'images') return fullPath;
                        const found = findInDir(fullPath, depth + 1);
                        if (found) return found;
                    }
                }
            } catch (e) { }
            return null;
        };
        imagesDir = findInDir(root) || findInDir(path.join(root, '..'));
    }

    try {
        if (!imagesDir) {
            console.error('Admin Images Debug - FAILED to find images folder.');
            console.log('CWD:', process.cwd());
            console.log('__dirname:', __dirname);
            // Return diagnostic info to the frontend
            return res.json({
                error: 'Folder not found',
                debug: {
                    cwd: process.cwd(),
                    dirname: __dirname,
                    cwd_files: fs.readdirSync(process.cwd()),
                    parent_files: fs.existsSync(path.join(process.cwd(), '..')) ? fs.readdirSync(path.join(process.cwd(), '..')) : 'Not found'
                }
            });
        }

        console.log('Admin Images Debug - Success! Found:', imagesDir);
        const files = fs.readdirSync(imagesDir);
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico'];

        const images = files
            .filter(file => imageExtensions.includes(path.extname(file).toLowerCase()))
            .map(file => ({
                name: file,
                url: `/images/${file}`
            }));

        console.log('Admin Images Debug - Filtered Images:', images.length);
        res.json(images);
    } catch (err) {
        console.error('Error reading images directory:', err);
        res.status(500).json({ message: 'Failed to list images' });
    }
});

module.exports = router;
