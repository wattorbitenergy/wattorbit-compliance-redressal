const mongoose = require('mongoose');

const automationHookSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },

    // Trigger configuration
    triggerEvent: {
        type: String,
        required: true,
        enum: [
            'booking.created',
            'booking.confirmed',
            'booking.assigned',
            'booking.in_progress',
            'booking.completed',
            'booking.cancelled',
            'booking.rescheduled',
            'payment.initiated',
            'payment.received',
            'payment.failed',
            'feedback.submitted',
            'feedback.reminder',
            'invoice.generated'
        ]
    },

    // Conditions (optional filters)
    conditions: [{
        field: {
            type: String,
            required: true
        },
        operator: {
            type: String,
            enum: ['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'contains', 'in'],
            required: true
        },
        value: {
            type: mongoose.Schema.Types.Mixed,
            required: true
        }
    }],

    // Actions to perform
    actions: [{
        type: {
            type: String,
            enum: [
                'send_email',
                'send_sms',
                'send_push_notification',
                'update_status',
                'assign_technician',
                'generate_invoice',
                'request_feedback',
                'send_payment_reminder'
            ],
            required: true
        },
        config: {
            type: mongoose.Schema.Types.Mixed,
            required: true
        },
        delay: {
            type: Number, // Delay in seconds before executing
            default: 0,
            min: 0
        }
    }],

    isActive: {
        type: Boolean,
        default: true
    },
    priority: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },

    // Execution tracking
    executionCount: {
        type: Number,
        default: 0
    },
    lastExecutedAt: {
        type: Date
    },
    failureCount: {
        type: Number,
        default: 0
    },

    // Execution logs (keep last 100)
    executionLogs: [{
        executedAt: {
            type: Date,
            default: Date.now
        },
        success: {
            type: Boolean,
            required: true
        },
        error: {
            type: String
        },
        data: {
            type: mongoose.Schema.Types.Mixed
        }
    }]
}, { timestamps: true });

// Indexes for efficient queries
automationHookSchema.index({ triggerEvent: 1, isActive: 1 });
automationHookSchema.index({ priority: -1 });

// Limit execution logs to last 100 entries
automationHookSchema.pre('save', function (next) {
    if (this.executionLogs && this.executionLogs.length > 100) {
        this.executionLogs = this.executionLogs.slice(-100);
    }
    next();
});

module.exports = mongoose.model('AutomationHook', automationHookSchema);
