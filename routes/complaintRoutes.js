const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const axios = require('axios');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');

const Complaint = require('../models/Complaint');
const Counter = require('../models/Counter');
const User = require('../models/User');
const admin = require('firebase-admin'); // For FCM

// Helper: Safely send FCM
const sendFCM = async (topic, title, body) => {
  if (admin.apps.length) {
    try {
      await admin.messaging().send({
        topic,
        notification: { title, body }
      });
      console.log(`FCM Sent to '${topic}': ${title}`);
    } catch (e) {
      console.error(`FCM Fail for '${topic}':`, e.message);
    }
  }
};

/* ============================
   MIDDLEWARE: VERIFY TOKEN
============================ */
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: 'Authorization header missing' });
  }

  const token = authHeader.split(' ')[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

/* ============================
   SMTP TRANSPORTER
============================ */
// 465 = SSL (secure: true), 587/2525 = STARTTLS (secure: false)
const isSecure = Number(process.env.SMTP_PORT) === 465;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: isSecure,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  tls: {
    // Mailjet/Render often require this for STARTTLS on port 587
    rejectUnauthorized: false,
    ciphers: 'SSLv3'
  },
  connectionTimeout: 20000, // Increased to 20s for Render cold starts
  greetingTimeout: 20000,
  socketTimeout: 20000
});

// Verify connection configuration
transporter.verify((err, success) => {
  if (err) {
    console.error('SMTP VERIFY FAILED:', err.message);
    console.error('PRO-TIP: If using Gmail, use App Passwords. If Render, try Port 465 (secure) or 587 (unsecure).');
  } else {
    console.log(`SMTP SERVER READY (Secure: ${isSecure})`);
  }
});

const sendEmail = async (to, subject, html) => {
  if (!to || !process.env.SMTP_USER) return;
  try {
    await transporter.sendMail({
      from: `"WattOrbit Support" <${process.env.SMTP_USER}>`,
      replyTo: "no-reply@wattorbit.in",
      to,
      subject,
      html
    });
    console.log(`Email sent to ${to}: ${subject}`);
  } catch (err) {
    console.error('Email send failed:', err.message);
  }
};

/* ============================
   GET: Fetch Complaints (Role-Based)
============================ */
router.get('/', verifyToken, async (req, res) => {
  try {
    const { role, username, email, phone, organisationId } = req.user;
    let query = {};

    switch (role) {
      case 'admin':
      case 'engineer':
        // Admin and Engineer see all
        query = {};
        break;

      case 'technician':
        // Technician sees ONLY assigned to them
        query = { assignedTechnician: username };
        break;

      case 'organisation':
        // Organisation sees ONLY their users' data
        if (organisationId) {
          const orgUsers = await User.find({ organisationId }).select('phone email');
          const phones = orgUsers.map(u => u.phone).filter(Boolean);
          const emails = orgUsers.map(u => u.email).filter(Boolean);
          query = {
            $or: [
              { phone: { $in: phones } },
              { email: { $in: emails } }
            ]
          };
        } else {
          query = { $or: [{ phone }, { email }] };
        }
        break;

      case 'user':
        // User sees ONLY own complaints
        query = {
          $or: [
            { phone: phone || "no-phone-match" },
            { email: email || "no-email-match" }
          ]
        };
        break;

      default:
        return res.status(403).json({ message: 'Unknown role' });
    }

    const complaints = await Complaint.find(query).sort({ createdAt: -1 });
    res.json(complaints);

  } catch (err) {
    console.error('Fetch error:', err);
    res.status(500).json({ message: err.message });
  }
});

/* ============================
   GET: Track (Public/Robust)
============================ */
router.get('/track', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ message: 'Query required' });

  try {
    // Search by Ticket ID
    let complaints = await Complaint.find({ complaintId: query });

    // Search by Phone
    if (complaints.length === 0) {
      complaints = await Complaint.find({ phone: query });
    }

    // Search by ObjectId (optional robustness)
    if (complaints.length === 0 && mongoose.Types.ObjectId.isValid(query)) {
      complaints = await Complaint.find({ _id: query });
    }

    // Sensitivity filter: Hide technician phone from public track if exists
    const safeComplaints = complaints.map(c => {
      const obj = c.toObject();
      delete obj.assignedTechnicianPhone;
      return obj;
    });

    res.json(safeComplaints);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ============================
   WHATSAPP: Privacy Preserving
============================ */
// 1. Employee -> User
router.get('/:id/whatsapp/user', verifyToken, async (req, res) => {
  try {
    const { role, username } = req.user;
    const complaint = await Complaint.findById(req.params.id);

    if (!complaint) return res.status(404).json({ message: 'Complaint not found' });

    // Security Check
    if (role === 'technician' && complaint.assignedTechnician !== username) {
      return res.status(403).json({ message: 'Not assigned to this complaint' });
    }
    if (role === 'user') {
      return res.status(403).json({ message: 'Users cannot initiate chat this way' });
    }

    const targetPhone = complaint.phone;
    if (!targetPhone) return res.status(404).json({ message: 'No phone number on file' });

    const message = `Hello, regarding Complaint ID ${complaint.complaintId}`;
    const waUrl = `https://wa.me/${targetPhone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;

    res.json({ waUrl });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 2. User -> Technician
router.get('/:id/whatsapp/technician', verifyToken, async (req, res) => {
  try {
    const { role, phone, email } = req.user;
    const complaint = await Complaint.findById(req.params.id);

    if (!complaint) return res.status(404).json({ message: 'Complaint not found' });

    // Security Check: User must own the complaint
    const isOwner = (complaint.phone === phone) || (complaint.email === email);
    if (role === 'user' && !isOwner) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (!complaint.assignedTechnician) {
      return res.status(404).json({ message: 'No technician assigned yet' });
    }

    const technician = await User.findOne({ username: complaint.assignedTechnician });
    if (!technician || !technician.phone) {
      return res.status(404).json({ message: 'Technician contact unavailable' });
    }

    const message = `Hello, regarding Complaint ID ${complaint.complaintId}`;
    const waUrl = `https://wa.me/${technician.phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;

    res.json({ waUrl });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 3. Admin/Engineer/Technician -> Target (User/Technician/Admin)
router.get('/:id/whatsapp/target/:roleName', verifyToken, async (req, res) => {
  try {
    const { role } = req.user;
    const { roleName } = req.params;

    // Security Check
    if (role !== 'admin' && role !== 'engineer' && role !== 'technician') {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Technicians can only contact admin or the user via this or other specific endpoints
    if (role === 'technician' && roleName !== 'admin') {
      return res.status(403).json({ message: 'Technicians can only contact HQ' });
    }

    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ message: 'Complaint not found' });

    let targetPhone = '';
    let message = `Hello, regarding Complaint ID ${complaint.complaintId || complaint._id}`;

    if (roleName === 'user') {
      targetPhone = complaint.phone;
    } else if (roleName === 'technician') {
      if (!complaint.assignedTechnician) return res.status(404).json({ message: 'No technician assigned' });
      const tech = await User.findOne({ username: complaint.assignedTechnician });
      if (!tech) return res.status(404).json({ message: 'Technician not found' });
      targetPhone = tech.phone;
    } else if (roleName === 'admin') {
      // Escalation to Admin
      targetPhone = '917379092670';
      message = `Escalation for ID ${complaint.complaintId || complaint._id}`;
    } else {
      return res.status(400).json({ message: 'Invalid target role' });
    }

    if (!targetPhone) return res.status(404).json({ message: 'Phone number not available' });

    const waUrl = `https://wa.me/${targetPhone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;

    res.json({ waUrl });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ============================
   POST: Create Complaint
============================ */
router.post('/', async (req, res) => {
  try {
    const {
      type, customerName, phone, email, city, address, issueType, description
    } = req.body;

    if (!customerName || !phone || !city || !issueType) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const isService = type === 'Service Request';
    const prefix = isService ? 'WSR' : 'WCR';
    const year = new Date().getFullYear();
    const counterKey = isService ? `serviceId-${year}` : `complaintId-${year}`;

    let counter = await Counter.findById(counterKey);
    if (!counter) counter = await Counter.create({ _id: counterKey, seq: 1000 });

    counter.seq += 1;
    await counter.save();

    const complaint = new Complaint({
      complaintId: `${prefix}-${year}-${counter.seq}`,
      type: isService ? 'Service Request' : 'Complaint',
      customerName, phone, email, city, address, issueType, description
    });

    const saved = await complaint.save();

    // Acknowledgement Email
    if (saved.email) {
      const subject = `Complaint Registered – ${saved.complaintId}`;
      const html = `
        <p>Dear ${saved.customerName},</p>
        <p>Your <b>${saved.type}</b> has been successfully registered.</p>
        <p>
          <b>Ticket ID:</b> ${saved.complaintId}<br/>
          <b>City:</b> ${saved.city}<br/>
          <b>Issue:</b> ${saved.issueType}
        </p>
        <p>Our support team will contact you shortly.</p>
        <p style="color: gray; font-size: 12px;">This is an automated message. Please do not reply.</p>
      `;
      sendEmail(saved.email, subject, html);
    }

    // Admin SMS via Fast2SMS (Optional)
    if (process.env.FAST2SMS_API_KEY && process.env.WHATSAPP_ADMIN_NUMBER) {
      try {
        axios.get('https://www.fast2sms.com/dev/bulkV2', {
          params: {
            authorization: process.env.FAST2SMS_API_KEY,
            route: 'q',
            message: `New ${saved.type} created. ID: ${saved.complaintId}`,
            numbers: process.env.WHATSAPP_ADMIN_NUMBER.replace(/\+/g, '')
          }
        }).catch(err => console.error('Fast2SMS bg error:', err.message));
      } catch (smsErr) {
        console.error('Fast2SMS create failed:', smsErr.message);
      }
    }

    // FCM Notification: New Ticket Created -> Notify Admin & Techs
    sendFCM('admin', 'New Ticket Created', `ID: ${saved.complaintId} | ${saved.issueType} by ${saved.customerName}`);
    sendFCM('technician', 'New Job Available', `ID: ${saved.complaintId} | Location: ${saved.city}`);

    res.status(201).json(saved);
  } catch (err) {
    console.error('Create error:', err);
    res.status(500).json({ message: err.message });
  }
});

/* ============================
   PATCH: Update Complaint
============================ */
router.patch('/:id', verifyToken, async (req, res) => {
  try {
    const { role, username } = req.user;
    const { status, assignedTechnician, remark, assignedTechnicianPhone, rescheduleReason } = req.body;

    const oldComplaint = await Complaint.findById(req.params.id);
    if (!oldComplaint) return res.status(404).json({ message: 'Complaint not found' });

    // Role-Based Authorization
    if (role === 'technician') {
      if (oldComplaint.assignedTechnician !== username) {
        return res.status(403).json({ message: 'Not authorized for this assignment' });
      }
      // Technicians can only update status/remark, not reassign
      if (assignedTechnician && assignedTechnician !== username) {
        return res.status(403).json({ message: 'Cannot reassign from technician role' });
      }
    } else if (role !== 'admin' && role !== 'engineer') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // Auto-fetch technician phone if assignedTechnician is provided
    let updateData = { ...req.body, updatedAt: new Date() };
    if (assignedTechnician && (assignedTechnician !== oldComplaint.assignedTechnician)) {
      const techUser = await User.findOne({ username: assignedTechnician });
      if (techUser && techUser.phone) {
        updateData.assignedTechnicianPhone = techUser.phone;
      }
    }

    const updated = await Complaint.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    // Status Update Email
    if (status && oldComplaint.status !== status) {
      // 1. Notify User via Email (Existing)
      if (updated.email) {
        const subject = `Update on Ticket ${updated.complaintId} - Status: ${status}`;
        const html = `
          <p>Dear ${updated.customerName},</p>
          <p>The status of your ticket <b>${updated.complaintId}</b> has been updated.</p>
          <p>
              <b>New Status:</b> <span style="color: blue; font-weight: bold;">${status}</span><br>
              ${updated.assignedTechnician ? `<b>Assigned Technician:</b> ${updated.assignedTechnician}<br>` : ''}
              ${remark ? `<b>Remark:</b> ${remark}<br>` : ''}
          </p>
          <p>Thank you for choosing WattOrbit.</p>
          <p style="color: gray; font-size: 12px;">This is an automated message. Please do not reply.</p>
        `;
        sendEmail(updated.email, subject, html);
      }

      // 2. FCM Notification (Real-time App Update)
      // Notify Admin
      sendFCM('admin', 'Ticket Status Updated', `${updated.complaintId} is now ${status}`);

      // Notify Specific User (Topic: user_PHONE_NUMBER) - Sanitized
      if (updated.phone) {
        const userTopic = `user_${updated.phone.replace(/\D/g, '')}`; // Format: user_<digits>
        sendFCM(userTopic, 'Complaint Update', `Your ticket ${updated.complaintId} is ${status}`);
      }

      // 3. Notify Technician if assigned or reassigned
      if (updated.assignedTechnician && (oldComplaint.assignedTechnician !== updated.assignedTechnician)) {
        const techTopic = `tech_${updated.assignedTechnician}`;
        sendFCM(techTopic, 'New Assignment', `You have been assigned to Ticket ${updated.complaintId}`);
      }
    }

    res.json(updated);
  } catch (err) {
    console.error('Update error:', err);
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
