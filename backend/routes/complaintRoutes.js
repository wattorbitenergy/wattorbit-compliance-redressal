const express = require('express');
const router = express.Router();
const Complaint = require('../models/Complaint');

const Counter = require('../models/Counter');
const axios = require('axios');

// GET track complaint by ID or Phone
router.get('/track', async (req, res) => {
    const { query } = req.query;
    if (!query) return res.status(400).json({ message: "Query parameter required" });

    try {
        // Search by complaintId first, then Phone, then ObjectId
        let complaints = await Complaint.find({ complaintId: query });

        if (complaints.length === 0) {
            complaints = await Complaint.find({ phone: query });
        }

        // For backward compatibility or direct ID usage
        if (complaints.length === 0 && require('mongoose').Types.ObjectId.isValid(query)) {
            complaints = await Complaint.find({ _id: query });
        }

        res.json(complaints);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// GET all complaints
router.get('/', async (req, res) => {
    try {
        const complaints = await Complaint.find();
        res.json(complaints);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// POST new complaint
// POST new ticket (Complaint or Service Request)
router.post('/', async (req, res) => {
    try {
        const { type } = req.body;
        const prefix = type === 'Service Request' ? 'WSR' : 'WCR';
        const counterName = type === 'Service Request' ? 'serviceId' : 'complaintId';

        // Generate Sequence
        const counter = await Counter.findByIdAndUpdate(
            counterName,
            { $inc: { seq: 1 } },
            { new: true, upsert: true }
        );

        const complaint = new Complaint({
            complaintId: `${prefix}-${counter.seq}`,
            type: type || 'Complaint',
            customerName: req.body.customerName,
            phone: req.body.phone,
            email: req.body.email,
            city: req.body.city,
            address: req.body.address,
            issueType: req.body.issueType,
            description: req.body.description
        });

        const newComplaint = await complaint.save();
        // SMS notification on creation (optional) - Fast2SMS
        if (process.env.FAST2SMS_API_KEY && process.env.WHATSAPP_ADMIN_NUMBER) {
            const message = `New ${type || 'Complaint'} created. ID: ${newComplaint.complaintId}. Customer: ${newComplaint.customerName}`;
            try {
                await axios.get(`https://www.fast2sms.com/dev/bulkV2`, {
                    params: {
                        authorization: process.env.FAST2SMS_API_KEY,
                        route: 'q', // transactional route
                        message: message,
                        numbers: process.env.WHATSAPP_ADMIN_NUMBER.replace(/\+/g, '')
                    }
                });
            } catch (smsErr) {
                console.error('Fast2SMS creation notification failed:', smsErr.message);
            }
        }
        res.status(201).json(newComplaint);
    } catch (err) {
        console.error('Error saving ticket:', err);
        res.status(500).json({ message: err.message });
    }
});

// PUT update complaint (Admin)
router.patch('/:id', async (req, res) => {
    try {
        const { status, assignedTechnician, assignedTechnicianPhone, pendingReason } = req.body;
        const updatedComplaint = await Complaint.findByIdAndUpdate(
            req.params.id,
            { status, assignedTechnician, assignedTechnicianPhone, pendingReason },
            { new: true }
        );

        // SMS notification on update (optional) - Fast2SMS
        if (process.env.FAST2SMS_API_KEY && process.env.WHATSAPP_ADMIN_NUMBER) {
            let updates = [];
            if (status) updates.push(`Status: ${status}`);
            if (assignedTechnician) updates.push(`Assigned: ${assignedTechnician}`);
            const updateMsg = updates.length ? updates.join(' | ') : 'Updated';
            const message = `Ticket ${updatedComplaint.complaintId} update: ${updateMsg}`;

            try {
                // Notify Admin
                await axios.get(`https://www.fast2sms.com/dev/bulkV2`, {
                    params: {
                        authorization: process.env.FAST2SMS_API_KEY,
                        route: 'q',
                        message: message,
                        numbers: process.env.WHATSAPP_ADMIN_NUMBER.replace(/\+/g, '')
                    }
                });

                // Also notify technician if assigned
                if (assignedTechnicianPhone) {
                    const techNumber = assignedTechnicianPhone.replace(/\+/g, '').replace(/^91/, '');
                    await axios.get(`https://www.fast2sms.com/dev/bulkV2`, {
                        params: {
                            authorization: process.env.FAST2SMS_API_KEY,
                            route: 'q',
                            message: `You've been assigned ticket ${updatedComplaint.complaintId}. Status: ${status || 'Pending'}`,
                            numbers: techNumber
                        }
                    });
                }
            } catch (smsErr) {
                console.error('Fast2SMS update notification failed:', smsErr.message);
            }
        }

        res.json(updatedComplaint);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

module.exports = router;
