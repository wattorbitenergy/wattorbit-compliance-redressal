const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const axios = require('axios');

const Complaint = require('../models/Complaint');
const Counter = require('../models/Counter');

/* ======================================================
   GET: Track complaint by ID / Phone / Mongo ObjectId
====================================================== */
router.get('/track', async (req, res) => {
  const { query } = req.query;
  if (!query) {
    return res.status(400).json({ message: 'Query parameter required' });
  }

  try {
    let complaints = await Complaint.find({ complaintId: query });

    if (complaints.length === 0) {
      complaints = await Complaint.find({ phone: query });
    }

    if (
      complaints.length === 0 &&
      mongoose.Types.ObjectId.isValid(query)
    ) {
      complaints = await Complaint.find({ _id: query });
    }

    res.json(complaints);
  } catch (err) {
    console.error('Track error:', err);
    res.status(500).json({ message: err.message });
  }
});

/* ============================
   GET: All complaints
============================ */
router.get('/', async (req, res) => {
  try {
    const complaints = await Complaint.find().sort({ createdAt: -1 });
    res.json(complaints);
  } catch (err) {
    console.error('Fetch error:', err);
    res.status(500).json({ message: err.message });
  }
});

/* ======================================================
   POST: Create Complaint / Service Request
   ID FORMAT:
   Complaint       → WCR-2025-1001
   Service Request → WSR-2025-1001
====================================================== */
router.post('/', async (req, res) => {
  try {
    const {
      type,
      customerName,
      phone,
      email,
      city,
      address,
      issueType,
      description
    } = req.body;

    // 🔒 Required validation
    if (!customerName || !phone || !city || !issueType) {
      return res.status(400).json({
        message: 'customerName, phone, city, and issueType are required'
      });
    }

    const isService = type === 'Service Request';
    const prefix = isService ? 'WSR' : 'WCR';
    const year = new Date().getFullYear();

    // Year-based counter key
    const counterKey = isService
      ? `serviceId-${year}`
      : `complaintId-${year}`;

    // Increment yearly counter
    const counter = await Counter.findByIdAndUpdate(
      counterKey,
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    const generatedId = `${prefix}-${year}-${counter.seq}`;

    const complaint = new Complaint({
      complaintId: generatedId,
      type: isService ? 'Service Request' : 'Complaint',
      customerName,
      phone,
      email,
      city,
      address,
      issueType,
      description
    });

    const savedComplaint = await complaint.save();

    // 🔔 Optional SMS (Admin)
    if (process.env.FAST2SMS_API_KEY && process.env.WHATSAPP_ADMIN_NUMBER) {
      try {
        await axios.get('https://www.fast2sms.com/dev/bulkV2', {
          params: {
            authorization: process.env.FAST2SMS_API_KEY,
            route: 'q',
            message: `New ${savedComplaint.type} created. ID: ${savedComplaint.complaintId}`,
            numbers: process.env.WHATSAPP_ADMIN_NUMBER.replace(/\+/g, '')
          }
        });
      } catch (smsErr) {
        console.error('Fast2SMS create failed:', smsErr.message);
      }
    }

    res.status(201).json(savedComplaint);

  } catch (err) {
    console.error('Create error:', err);
    res.status(500).json({ message: err.message });
  }
});

/* ======================================================
   PATCH: Update Complaint (Admin)
====================================================== */
router.patch('/:id', async (req, res) => {
  try {
    const {
      status,
      assignedTechnician,
      assignedTechnicianPhone,
      rescheduleReason,
      remark
    } = req.body;

    const updatedComplaint = await Complaint.findByIdAndUpdate(
      req.params.id,
      {
        status,
        assignedTechnician,
        assignedTechnicianPhone,
        rescheduleReason,
        remark,
        updatedAt: new Date() // ensures timeline update
      },
      { new: true, runValidators: true }
    );

    if (!updatedComplaint) {
      return res.status(404).json({ message: 'Complaint not found' });
    }

    // 🔔 Optional SMS
    if (process.env.FAST2SMS_API_KEY) {
      try {
        let updates = [];
        if (status) updates.push(`Status: ${status}`);
        if (assignedTechnician) updates.push(`Assigned: ${assignedTechnician}`);
        const updateText = updates.length ? updates.join(' | ') : 'Updated';

        // Admin notify
        if (process.env.WHATSAPP_ADMIN_NUMBER) {
          await axios.get('https://www.fast2sms.com/dev/bulkV2', {
            params: {
              authorization: process.env.FAST2SMS_API_KEY,
              route: 'q',
              message: `Ticket ${updatedComplaint.complaintId} update: ${updateText}`,
              numbers: process.env.WHATSAPP_ADMIN_NUMBER.replace(/\+/g, '')
            }
          });
        }

        // Technician notify
        if (assignedTechnicianPhone) {
          const techNumber = assignedTechnicianPhone
            .replace(/\+/g, '')
            .replace(/^91/, '');

          await axios.get('https://www.fast2sms.com/dev/bulkV2', {
            params: {
              authorization: process.env.FAST2SMS_API_KEY,
              route: 'q',
              message: `You are assigned ticket ${updatedComplaint.complaintId}`,
              numbers: techNumber
            }
          });
        }

      } catch (smsErr) {
        console.error('Fast2SMS update failed:', smsErr.message);
      }
    }

    res.json(updatedComplaint);

  } catch (err) {
    console.error('Update error:', err);
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
