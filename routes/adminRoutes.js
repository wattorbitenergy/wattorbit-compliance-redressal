const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Complaint = require('../models/Complaint');
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
                // Organisation: Only see tickets from their users
                const orgUsers = await User.find({ organisationId: user._id }).select('phone email');
                const phones = orgUsers.map(u => u.phone).filter(Boolean);
                const emails = orgUsers.map(u => u.email).filter(Boolean);
                query.$or = [
                    { phone: { $in: phones } },
                    { email: { $in: emails } }
                ];
            } else if (user.role === 'technician') {
                // Technician: Only see tickets assigned to them
                query.assignedTechnician = user.username;
            } else if (user.role === 'user') {
                // User: Only see their own tickets
                query.$or = [
                    { phone: user.phone || "no-match" },
                    { email: user.email || "no-match" }
                ];
            }
            // Admin/Engineer/Others: See ALL tickets (default query)

            // 3. Fetch Data
            const complaints = await Complaint.find(query).sort({ createdAt: -1 });

            // 4. Generate Stats
            const total = complaints.length;
            const resolved = complaints.filter(c => c.status === 'Resolved').length;
            const pending = complaints.filter(c => c.status === 'Created-Unassigned' || c.status === 'Assigned').length;
            const inProgress = total - resolved - pending;

            // 5. Build HTML
            const summaryHtml = `
              <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 10px; max-width: 600px;">
                <h2 style="color: #1e3a8a;">WattOrbit - Weekly Ticket Summary</h2>
                <p style="color: #555;">Hello <b>${user.username}</b>,</p>
                <p style="color: #555;">Here is the overview of complaint activity relevant to your account for the week of <b>${start.toLocaleDateString()} to ${end.toLocaleDateString()}</b>.</p>
                
                <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                  <tr style="background-color: #f3f4f6;">
                    <th style="padding: 10px; border: 1px solid #ddd;">Total Tickets</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">Resolved</th>
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
                  ${complaints.length > 0
                    ? complaints.slice(0, 5).map(c => `<li><b>${c.complaintId}</b>: ${c.status} (${c.type})</li>`).join('')
                    : '<li>No activity recorded this week.</li>'
                }
                </ul>
                ${complaints.length > 5 ? `<p style="font-size: 12px; color: #888;">+ ${complaints.length - 5} more tickets...</p>` : ''}
                
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
router.get('/config/:key', async (req, res) => {
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

module.exports = router;
