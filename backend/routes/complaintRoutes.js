const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const axios = require('axios');
const nodemailer = require('nodemailer');

const Complaint = require('../models/Complaint');
const Counter = require('../models/Counter');

/* ============================
   SMTP TRANSPORTER
============================ */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false, // true only for 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

/* ======================================================
   GET: Track complaint by ID / Phone / ObjectId
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
    const complaints = await Complaint.find()
      .sort({ createdAt: -1 })
      .lean();

    res.json(complaints);
  } catch (err) {
    console.error('Fetch error:', err);
    res.status(500).json({ message: err.message });
  }
});

/* ======================================================
   POST: Create Complaint / Service Request
   FORMAT:
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

    // Required validation
    if (!customerName || !phone || !city || !issueType) {
      return res.status(400).json({
        message: 'customerName, phone, city, and issueType are required'
      });
    }

    const isService = type === 'Service Request';
    const prefix = isService ? 'WSR' : 'WCR';
    const year = new Date().getFullYear();

    const counterKey = isService
      ? `serviceId-${year}`
      : `complaintId-${year}`;

    // Safe counter handling (NO duplicate error)
    let counter = await Counter.findById(counterKey);
    if (!counter) {
      counter = await Counter.create({
        _id: counterKey,
        seq: 1000
      });
    }

    counter.seq += 1;
    await counter.save();

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

    /* ============================
       ACKNOWLEDGEMENT EMAIL
    ============================ */
    if (savedComplaint.email) {
      try {
        await transporter.sendMail({
          from: process.env.SMTP_FROM,
          to: savedComplaint.email,
          subject: `Complaint Registered – ${savedComplaint.complaintId}`,
          html: `
            <p>Dear ${savedComplaint.customerName},</p>

            <p>Your <b>${savedComplaint.type}</b> has been successfully registered.</p>

            <p>
              <b>Ticket ID:</b> ${savedComplaint.complaintId}<br/>
              <b>City:</b> ${savedComplaint.city}<br/>
              <b>Issue:</b> ${savedComplaint.issueType}
            </p>

            <p>Our support team will contact you shortly.</p>

            <p>
              Regards,<br/>
              <b>WattOrbit Support Team</b>
            </p>
          `
        });
      } catch (emailErr) {
        console.error('Acknowledgement email failed:', emailErr.message);
      }
    }

    /* ============================
       ADMIN SMS (OPTIONAL)
    ============================ */
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
        updatedAt: new Date()
      },
      { new: true, runValidators: true }
    );

    if (!updatedComplaint) {
      return res.status(404).json({ message: 'Complaint not found' });
    }

    res.json(updatedComplaint);

  } catch (err) {
    console.error('Update error:', err);
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
