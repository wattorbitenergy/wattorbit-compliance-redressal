const express = require('express');
const router = express.Router();
const WorkPermit = require('../models/WorkPermit');
const { generateWorkPermitId } = require('../utils/idGenerator');
const jwt = require('jsonwebtoken');
const { generateWorkPermitPDF } = require('../utils/pdfGenerator');
const { sendTopicNotification } = require('../utils/notificationHelper');
const path = require('path');
const fs = require('fs');

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

// Admin or Engineer check middleware
const isAdminOrEngineer = (req, res, next) => {
    if (req.user.role !== 'admin' && req.user.role !== 'engineer') {
        return res.status(403).json({ message: 'Admin or Engineer access required' });
    }
    next();
};

// POST: Create new work permit
router.post('/', verifyToken, async (req, res) => {
    try {
        const permitId = await generateWorkPermitId();
        const workPermit = new WorkPermit({
            ...req.body,
            permitId,
            createdBy: req.user.id
        });

        await workPermit.save();

        // Notify Engineer
        if (workPermit.engineerMobile) {
            const topic = `user_${workPermit.engineerMobile.replace(/\D/g, "")}`;
            await sendTopicNotification(topic, "New Permit Request", `A new permit for ${workPermit.equipment} has been requested.`);
        }

        res.status(201).json({ message: 'Work permit created successfully', workPermit });
    } catch (err) {
        console.error('Error creating work permit:', err);
        res.status(500).json({ message: 'Failed to create work permit' });
    }
});

// GET: Get all work permits (Admin/Engineer/Org supervise)
router.get('/', verifyToken, async (req, res) => {
    try {
        let query = {};

        // Scoping logic
        if (req.user.role === 'engineer') {
            if (req.user.organisationId) {
                // Org Engineer sees only their org's permits
                // Note: We might need to add organisationId to WorkPermit model if we want strict scoping
                // For now, let's assume they can see all if they are engineers, or filter by createdBy
            }
        } else if (req.user.role === 'organisation') {
            // query.organisationId = req.user.id;
        } else if (req.user.role === 'user') {
            query.createdBy = req.user.id;
        }

        const permits = await WorkPermit.find(query)
            .populate('createdBy', 'name username role')
            .sort({ createdAt: -1 });

        res.json(permits);
    } catch (err) {
        console.error('Error fetching work permits:', err);
        res.status(500).json({ message: 'Failed to fetch work permits' });
    }
});

// GET: My Permits (No token required, searches by mobile)
router.get('/my-permits', async (req, res) => {
    try {
        const { m } = req.query;
        if (!m) return res.status(400).json({ message: "Mobile number required" });

        const permits = await WorkPermit.find({
            $or: [
                { requesterMobile: m },
                { engineerMobile: m },
                { "approvers.mobileNo": m }
            ]
        }).sort({ createdAt: -1 });

        res.json(permits);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// GET: Get specific work permit
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        let query = {};
        if (id.match(/^[0-9a-fA-F]{24}$/)) {
            query = { $or: [{ _id: id }, { permitId: id }] };
        } else {
            query = { permitId: id };
        }

        const permit = await WorkPermit.findOne(query).populate('createdBy', 'name username');
        if (!permit) return res.status(404).json({ message: 'Work permit not found' });

        res.json(permit);
    } catch (err) {
        console.error('Error fetching work permit details:', err);
        res.status(500).json({ message: 'Failed to fetch work permit details' });
    }
});

// PATCH: Engineer update (Sections E, F, G + Approvers)
router.patch('/:id/engineer-update', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { hazards, preparation, ppe, approvers, isolation, certifications } = req.body;

        const permit = await WorkPermit.findById(id);
        if (!permit) return res.status(404).json({ message: 'Work permit not found' });

        // Update sections
        if (hazards) permit.hazards = hazards;
        if (preparation) permit.preparation = preparation;
        if (ppe) permit.ppe = ppe;
        if (isolation) permit.isolation = { ...permit.isolation, ...isolation };
        if (certifications?.issuer) permit.certifications.issuer = { ...permit.certifications.issuer, ...certifications.issuer };

        // Add approvers (Section K mobile numbers)
        if (approvers && Array.isArray(approvers)) {
            permit.approvers = approvers.map(app => ({
                name: app.name,
                mobileNo: app.mobileNo,
                status: 'Pending'
            }));
        }

        permit.status = 'Engineered';
        // After engineer signs, it moves to Pending Approval if approvers exist
        if (permit.approvers.length > 0) {
            permit.status = 'Pending Approval';
            // Notify Approvers
            for (const app of permit.approvers) {
                const topic = `user_${app.mobileNo.replace(/\D/g, "")}`;
                await sendTopicNotification(topic, "Permit Approval Required", `Permit for ${permit.equipment} is ready for your approval.`);
            }
        }

        await permit.save();
        res.json({ message: 'Permit updated by engineer', permit });
    } catch (err) {
        console.error('Error in engineer update:', err);
        res.status(500).json({ message: 'Failed to update permit' });
    }
});

// PATCH: Approve permit (by Approver)
router.patch('/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        const { mobileNo, signature, name } = req.body;

        const permit = await WorkPermit.findById(id);
        if (!permit) return res.status(404).json({ message: 'Work permit not found' });

        const approver = permit.approvers.find(a => a.mobileNo === mobileNo);
        if (!approver) return res.status(403).json({ message: 'Mobile number not authorized for approval' });

        approver.signature = signature;
        approver.name = name;
        approver.status = 'Approved';
        approver.updatedAt = new Date();

        // Check if all approvers have approved
        const allApproved = permit.approvers.every(a => a.status === 'Approved');
        if (allApproved) {
            permit.status = 'Approved';
            // Notify Requester
            if (permit.requesterMobile) {
                const topic = `user_${permit.requesterMobile.replace(/\D/g, "")}`;
                await sendTopicNotification(topic, "Permit Approved", `Your permit for ${permit.equipment} has been approved. Please accept to proceed.`);
            }
        }

        await permit.save();
        res.json({ message: 'Approval recorded', permit });
    } catch (err) {
        console.error('Error in approval:', err);
        res.status(500).json({ message: 'Failed to record approval' });
    }
});

// PATCH: Accept permit (by Requester)
router.patch('/:id/accept', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { signature, name, mobileNo } = req.body;

        const permit = await WorkPermit.findById(id);
        if (!permit) return res.status(404).json({ message: 'Work permit not found' });

        if (permit.status !== 'Approved') { // Corrected condition
            return res.status(400).json({ message: 'Permit must be approved before acceptance' });
        }

        permit.certifications.acceptor = {
            name,
            signature,
            mobileNo,
            date: new Date(),
            time: new Date().toLocaleTimeString()
        };
        permit.status = 'Accepted';

        await permit.save();

        // Generate PDF (Version 1)
        try {
            await generateWorkPermitPDF(permit);
        } catch (pdfErr) {
            console.error('PDF Generation Error:', pdfErr);
        }

        // Notify Engineer
        if (permit.engineerMobile) {
            const topic = `user_${permit.engineerMobile.replace(/\D/g, "")}`;
            await sendTopicNotification(topic, "Permit Accepted", `Permit for ${permit.equipment} has been accepted by the requester.`);
        }

        res.json({ message: 'Permit accepted successfully', permit });
    } catch (err) {
        console.error('Error in acceptance:', err);
        res.status(500).json({ message: 'Failed to accept permit' });
    }
});

// GET: Download Permit PDF
router.get('/:id/download', verifyToken, async (req, res) => {
    try {
        const permit = await WorkPermit.findById(req.params.id);
        if (!permit) return res.status(404).json({ message: 'Work permit not found' });

        const filename = `Permit_${permit.permitId}_V1.pdf`;
        const filePath = path.join(__dirname, '../uploads/permits', filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ message: 'PDF not found' });
        }

        res.download(filePath, filename);
    } catch (err) {
        console.error('Error downloading PDF:', err);
        res.status(500).json({ message: 'Failed to download PDF' });
    }
});

// PATCH: Request Renewal
router.patch('/:id/request-renewal', verifyToken, async (req, res) => {
    try {
        const permit = await WorkPermit.findById(req.params.id);
        if (!permit) return res.status(404).json({ message: 'Work permit not found' });

        permit.status = 'Renewal Requested';
        await permit.save();

        // Notify Engineer
        if (permit.engineerMobile) {
            const topic = `user_${permit.engineerMobile.replace(/\D/g, "")}`;
            await sendTopicNotification(topic, "Permit Renewal Request", `A renewal has been requested for permit ${permit.permitId} for ${permit.equipment}.`);
        }

        res.json({ message: 'Renewal requested', permit });
    } catch (err) {
        console.error('Error requesting renewal:', err);
        res.status(500).json({ message: 'Failed to request renewal' });
    }
});

// PATCH: Engineer Renew (Approve for renewal)
router.patch('/:id/engineer-renew', verifyToken, async (req, res) => {
    try {
        const { mobileNo, approvers } = req.body;
        const permit = await WorkPermit.findById(req.params.id);
        if (!permit) return res.status(404).json({ message: 'Work permit not found' });

        permit.engineerMobile = mobileNo;
        permit.status = 'Renewal Engineered';

        if (approvers && Array.isArray(approvers)) {
            permit.approvers = approvers.map(app => ({
                name: app.name,
                mobileNo: app.mobileNo,
                status: 'Pending'
            }));
            permit.status = 'Renewal Pending Approval';
        }

        await permit.save();
        res.json({ message: 'Renewal approved by engineer, pending approvers', permit });
    } catch (err) {
        console.error('Error in engineer renew:', err);
        res.status(500).json({ message: 'Failed to renew permit' });
    }
});



// GET: Public Print/Download (No token required, but uses permitId)
router.get('/public/print/:permitId', async (req, res) => {
    try {
        const { permitId } = req.params;
        const permit = await WorkPermit.findOne({ permitId });
        if (!permit) return res.status(404).json({ message: 'Work permit not found' });

        // Check if PDF exists, if not generate it
        const filename = `Permit_${permit.permitId}_V1.pdf`;
        const filePath = path.join(__dirname, '../uploads/permits', filename);

        if (!fs.existsSync(filePath)) {
            await generateWorkPermitPDF(permit);
        }

        res.download(filePath, filename);
    } catch (err) {
        console.error('Public print error:', err);
        res.status(500).json({ message: 'Failed to generate/download permit' });
    }
});

module.exports = router;
