const mongoose = require('mongoose');

const workPermitSchema = new mongoose.Schema({
    permitId: {
        type: String,
        unique: true,
        required: true
    },
    // Section A: Type of Work
    typeOfWork: {
        coldWork: { type: Boolean, default: false },
        hotWork: { type: Boolean, default: false },
        confinedSpace: { type: Boolean, default: false },
        excavation: { type: Boolean, default: false },
        workAtHeight: { type: Boolean, default: false },
        electrical: { type: Boolean, default: false }
    },
    // Section B: Job Details
    jobDetails: {
        dept: { type: String, required: true },
        location: { type: String, required: true },
        equipmentName: { type: String, required: true },
        equipmentTagNo: { type: String, required: true },
        jobDescription: { type: String, required: true },
        executionBy: { type: String, enum: ['Own Employees', 'Contractor'], required: true },
        personsAtWork: { type: Number, required: true }
    },
    // Section C - G: Checklists (Storing as arrays of strings/tags)
    natureOfWork: [String],
    toolsAndEquipment: [String],
    hazards: [String],
    preparation: [String],
    ppe: [String],

    // Section H: Isolation
    isolation: {
        required: { type: Boolean, default: false },
        checklist: [String],
        name: { type: String },
        signature: { type: String }, // Base64 signature
        signatureMethod: { type: String, enum: ['digital', 'visual'], default: 'digital' },
        mobileNo: { type: String },
        date: { type: Date },
        time: { type: String }
    },

    // Section I & Gas Test Record (Page 2)
    gasTestLogs: [{
        date: { type: Date },
        time: { type: String },
        flammablePercentage: { type: String },
        o2: { type: String },
        co: { type: String },
        so2_h2s: { type: String },
        anyOther: { type: String },
        location: { type: String },
        testedBy: { type: String },
        signature: { type: String } // Base64 signature
    }],

    // Validity
    validity: {
        from: { type: Date },
        to: { type: Date }
    },

    // Section J, K, L: Certifications
    certifications: {
        issuer: {
            name: { type: String },
            signature: { type: String },
            signatureMethod: { type: String, enum: ['digital', 'visual'], default: 'digital' },
            mobileNo: { type: String },
            date: { type: Date },
            time: { type: String }
        },
        approver: {
            name: { type: String },
            signature: { type: String },
            signatureMethod: { type: String, enum: ['digital', 'visual'], default: 'digital' },
            mobileNo: { type: String },
            date: { type: Date },
            time: { type: String }
        },
        acceptor: {
            name: { type: String },
            signature: { type: String },
            mobileNo: { type: String },
            date: { type: Date },
            time: { type: String }
        }
    },

    // Multi-approver logic for Section K
    approvers: [{
        name: { type: String },
        mobileNo: { type: String },
        signature: { type: String },
        signatureMethod: { type: String, enum: ['digital', 'visual'], default: 'digital' },
        status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
        updatedAt: { type: Date }
    }],

    specialInstructions: { type: String },

    // Section M: Workers (Page 2)
    workers: [{
        name: { type: String },
        empCode: { type: String }
    }],

    // Permit Renewal Record (Page 2)
    renewals: [{
        date: { type: Date },
        timeFrom: { type: String },
        timeTo: { type: String },
        issuerName: { type: String },
        acceptorName: { type: String },
        issuerSignature: { type: String },
        acceptorSignature: { type: String }
    }],

    // Section N: Permit Closure
    closure: {
        status: {
            type: String,
            enum: ['Job Completed & Housekeeping restored', 'Job to be Completed (Issue New Permit)', 'Permit Cancelled'],
            default: 'Job Completed & Housekeeping restored'
        },
        reason: { type: String },
        newPermitNo: { type: String },
        newPermitDate: { type: Date },
        powerRestoredBy: {
            name: { type: String },
            signature: { type: String },
            signatureMethod: { type: String, enum: ['digital', 'visual'], default: 'digital' },
            date: { type: Date },
            time: { type: String }
        },
        acceptor: {
            name: { type: String },
            signature: { type: String },
            signatureMethod: { type: String, enum: ['digital', 'visual'], default: 'digital' },
            date: { type: Date },
            time: { type: String }
        },
        issuer: {
            name: { type: String },
            signature: { type: String },
            signatureMethod: { type: String, enum: ['digital', 'visual'], default: 'digital' },
            date: { type: Date },
            time: { type: String }
        }
    },

    status: {
        type: String,
        enum: [
            'Draft',
            'Submitted',
            'Issued',
            'Approved',
            'Accepted',
            'Closed',
            'Cancelled',
            'Requested',
            'Engineered',
            'Pending Isolation',
            'Pending Issuer Approval',
            'Pending Approval',
            'Renewal Requested',
            'Renewal Engineered',
            'Renewal Pending Approval'
        ],
        default: 'Draft'
    },

    // Workflow Tracking
    engineerMobile: { type: String },
    requesterMobile: { type: String },

    renewalHistory: [{
        requestedBy: { type: String },
        engineerMobile: { type: String },
        approvals: [{
            name: { type: String },
            mobileNo: { type: String },
            signature: { type: String },
            updatedAt: { type: Date }
        }],
        status: { type: String },
        createdAt: { type: Date, default: Date.now }
    }],

    // Ownership
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, { timestamps: true });

workPermitSchema.index({ status: 1 });
workPermitSchema.index({ createdAt: -1 });

module.exports = mongoose.model('WorkPermit', workPermitSchema);
