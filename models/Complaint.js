
const mongoose = require('mongoose');

const complaintSchema = new mongoose.Schema(
  {
    complaintId: {
      type: String,
      required: true,
      unique: true
    },
    type: {
      type: String,
      enum: ['Complaint', 'Service Request'],
      default: 'Complaint'
    },
    customerName: {
      type: String,
      required: true
    },
    phone: {
      type: String,
      required: true
    },
    email: String,
    city: {
      type: String,
      required: true
    },
    address: String,
    issueType: {
      type: String,
      required: true
    },
    description: String,
    status: {
      type: String,
      enum: ['Pending', 'In Progress', 'Resolved', 'Scheduled'],
      default: 'Pending'
    },
    assignedTechnician: String,
    assignedTechnicianPhone: String,
    rescheduleReason: String,
    remark: String
  },
  { timestamps: true }
);

module.exports = mongoose.model('Complaint', complaintSchema);
