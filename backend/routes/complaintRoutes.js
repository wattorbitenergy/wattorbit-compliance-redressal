const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const axios = require('axios');

const Complaint = require('../models/Complaint');
const Counter = require('../models/Counter');

/* ======================================================
   GET: Track complaint by Complaint ID / Phone / ObjectId
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
   POST: Create new Complaint / Service Request
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

    // 🔒 Required field validation
    if (!customerName || !phone || !city || !issueType) {
      return res.status(400).json({
        message: 'customerName, phone, city, and issueType are required'
      });
    }

    const ticketType = type === 'Service Request' ? 'Service Request' : 'Complaint';
    const prefix = ticketType === 'Service Request' ? 'WSR' : 'WCR';
    const counterName = ticketType === 'Service Request' ? 'serviceId' : 'complaintId';

    // Generate sequential ID
    const counter = await Counter.findByIdAndUpdate(
      counterName,
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    const complaint = new Complaint({
      complaintId: `${prefix}-${counter.seq}`,
      type: ticketType,
      customerName,
      phone,
      email,
      city,
      address,
      issueType,
      description
    });

    const newComplaint = await complaint.save();

    // 🔔 Optional SMS notification (Admin)
    if (process.env.FAST2SMS_API_KEY && process.env.WHATSAPP_ADMIN_NUMBER) {
      try {
        await axios.get('https://www.fast2sms.com/dev/bulkV2', {
          params: {
            authorization: process.env.FAST2SMS_API_KEY,
            route: 'q',
            message: `New ${ticketType} created. ID: ${newComplaint.complaintId}. Customer: ${newComplaint.customerName}`,
            numbers: process.env.WHATSAPP_ADMIN_NUMBER.replace(/\+/g, '')
          }
        });
      } catch (smsErr) {
        console.error('Fast2SMS create notification failed:', smsErr.message);
      }
    }

    res.status(201).json(newComplaint);

  } catch (err) {
    console.error('Create complaint error:', err);
    res.status(500).json({ message: err.message });
  }
});

/* ======================================================
   PATCH: Update complaint (Admin)
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

    // 🔔 Optional SMS notifications
    if (process.env.FAST2SMS_API_KEY) {
      try {
        let updates = [];
        if (status) updates.push(`Status: ${status}`);
        if (assignedTechnician) updates.push(`Assigned: ${assignedTechnician}`);
        const updateText = updates.length ? updates.join(' | ') : 'Updated';

        // Notify admin
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

        // Notify technician
        if (assignedTechnicianPhone) {
          const techNumber = assignedTechnicianPhone
            .replace(/\+/g, '')
            .replace(/^91/, '');

          await axios.get('https://www.fast2sms.com/dev/bulkV2', {
            params: {
              authorization: process.env.FAST2SMS_API_KEY,
              route: 'q',
              message: `You are assigned ticket ${updatedComplaint.complaintId}. Status: ${status || 'Pending'}`,
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
    console.error('Update error:', err);
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
