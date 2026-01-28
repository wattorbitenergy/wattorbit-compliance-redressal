const AutomationHook = require('../models/AutomationHook');
const User = require('../models/User');
const Booking = require('../models/Booking');
const mailer = require('../routes/mailer');
const admin = require('firebase-admin');

/**
 * Trigger automation hooks for a specific event
 * @param {String} eventName - Event name (e.g., 'booking.created')
 * @param {Object} data - Event data (booking, payment, etc.)
 */
async function triggerAutomation(eventName, data) {
    try {
        // Find all active hooks for this event
        const hooks = await AutomationHook.find({
            triggerEvent: eventName,
            isActive: true
        }).sort({ priority: -1 });

        if (hooks.length === 0) {
            console.log(`No automation hooks found for event: ${eventName}`);
            return;
        }

        console.log(`Found ${hooks.length} automation hook(s) for event: ${eventName}`);

        // Ensure data is populated for interpolation
        await ensurePopulated(data);

        // Execute each hook
        for (const hook of hooks) {
            try {
                // Check conditions
                if (hook.conditions && hook.conditions.length > 0) {
                    const conditionsMet = evaluateConditions(hook.conditions, data);
                    if (!conditionsMet) {
                        console.log(`Conditions not met for hook: ${hook.name}`);
                        continue;
                    }
                }

                // Execute actions
                for (const action of hook.actions) {
                    // Handle delay
                    if (action.delay && action.delay > 0) {
                        setTimeout(async () => {
                            await executeAction(action, data, hook);
                        }, action.delay * 1000);
                    } else {
                        await executeAction(action, data, hook);
                    }
                }

                // Update execution stats
                hook.executionCount += 1;
                hook.lastExecutedAt = new Date();
                hook.executionLogs.push({
                    executedAt: new Date(),
                    success: true,
                    data: { event: eventName, dataId: data._id }
                });
                await hook.save();

            } catch (err) {
                console.error(`Error executing hook ${hook.name}:`, err);

                // Log failure
                hook.failureCount += 1;
                hook.executionLogs.push({
                    executedAt: new Date(),
                    success: false,
                    error: err.message,
                    data: { event: eventName, dataId: data._id }
                });
                await hook.save();
            }
        }
    } catch (err) {
        console.error('Error in triggerAutomation:', err);
    }
}

/**
 * Evaluate conditions against data
 * @param {Array} conditions - Array of condition objects
 * @param {Object} data - Data to evaluate against
 * @returns {Boolean} - True if all conditions met
 */
function evaluateConditions(conditions, data) {
    for (const condition of conditions) {
        const value = getNestedValue(data, condition.field);

        switch (condition.operator) {
            case 'eq':
                if (value !== condition.value) return false;
                break;
            case 'ne':
                if (value === condition.value) return false;
                break;
            case 'gt':
                if (value <= condition.value) return false;
                break;
            case 'lt':
                if (value >= condition.value) return false;
                break;
            case 'gte':
                if (value < condition.value) return false;
                break;
            case 'lte':
                if (value > condition.value) return false;
                break;
            case 'contains':
                if (!String(value).includes(condition.value)) return false;
                break;
            case 'in':
                if (!Array.isArray(condition.value) || !condition.value.includes(value)) return false;
                break;
            default:
                console.warn(`Unknown operator: ${condition.operator}`);
                return false;
        }
    }

    return true;
}

/**
 * Get nested value from object using dot notation
 * @param {Object} obj - Object to get value from
 * @param {String} path - Dot notation path (e.g., 'user.name')
 * @returns {*} - Value at path
 */
function getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Execute a single action
 * @param {Object} action - Action configuration
 * @param {Object} data - Event data
 * @param {Object} hook - Automation hook
 */
async function executeAction(action, data, hook) {
    console.log(`Executing action: ${action.type} for hook: ${hook.name}`);

    switch (action.type) {
        case 'send_email':
            await sendEmail(action.config, data);
            break;

        case 'send_sms':
            await sendSMS(action.config, data);
            break;

        case 'send_push_notification':
            await sendPushNotification(action.config, data);
            break;

        case 'update_status':
            await updateStatus(action.config, data);
            break;

        case 'assign_technician':
            await assignTechnician(action.config, data);
            break;

        case 'generate_invoice':
            await generateInvoice(action.config, data);
            break;

        case 'request_feedback':
            await requestFeedback(action.config, data);
            break;

        case 'send_payment_reminder':
            await sendPaymentReminder(action.config, data);
            break;

        default:
            console.warn(`Unknown action type: ${action.type}`);
    }
}

/**
 * Send email action
 */
async function sendEmail(config, data) {
    try {
        // Populate data if needed
        if (data.userId && !data.userId.email) {
            await data.populate('userId');
        }

        const to = interpolate(config.to, data) || data.userId?.email;
        const subject = interpolate(config.subject, data);
        const body = interpolate(config.body, data);

        if (!to) {
            console.warn('No email recipient found');
            return;
        }

        await mailer.sendMail({
            to,
            subject,
            html: body || `<p>${subject}</p>`
        });

        console.log(`Email sent to ${to}`);
    } catch (err) {
        console.error('Error sending email:', err);
        throw err;
    }
}

/**
 * Send SMS action (placeholder - implement with SMS gateway)
 */
async function sendSMS(config, data) {
    try {
        const to = interpolate(config.to, data);
        const message = interpolate(config.message, data);

        console.log(`SMS would be sent to ${to}: ${message}`);
        // TODO: Implement SMS gateway integration
    } catch (err) {
        console.error('Error sending SMS:', err);
        throw err;
    }
}

/**
 * Send push notification action
 */
async function sendPushNotification(config, data) {
    try {
        // Get user's FCM token
        let userId = data.userId;
        if (typeof userId === 'object' && userId._id) {
            userId = userId._id;
        }

        const user = await User.findById(userId);
        if (!user || !user.fcmToken) {
            console.warn('No FCM token found for user');
            return;
        }

        const title = interpolate(config.title, data);
        const body = interpolate(config.body, data);

        const message = {
            notification: {
                title,
                body
            },
            data: config.data || {},
            token: user.fcmToken
        };

        await admin.messaging().send(message);
        console.log(`Push notification sent to user ${user.name}`);
    } catch (err) {
        console.error('Error sending push notification:', err);
        throw err;
    }
}

/**
 * Update status action (for bookings)
 */
async function updateStatus(config, data) {
    try {
        if (data.constructor.modelName === 'Booking') {
            data.status = config.status;
            data.statusHistory.push({
                status: config.status,
                timestamp: new Date(),
                notes: 'Updated by automation'
            });
            await data.save();
            console.log(`Booking status updated to ${config.status}`);
        }
    } catch (err) {
        console.error('Error updating status:', err);
        throw err;
    }
}

/**
 * Auto-assign technician action
 */
async function assignTechnician(config, data) {
    try {
        if (data.constructor.modelName !== 'Booking') {
            console.warn('Auto-assign only works for bookings');
            return;
        }

        // Populate address to get city
        if (!data.addressId.city) {
            await data.populate('addressId');
        }

        const city = data.addressId.city;

        // Find available technician
        const query = {
            role: 'technician',
            isApproved: true,
            city: city
        };

        // Apply criteria from config
        if (config.criteria) {
            Object.assign(query, config.criteria);
        }

        const technicians = await User.find(query);

        if (technicians.length === 0) {
            console.warn(`No available technicians found in ${city}`);
            return;
        }

        // Select technician based on strategy
        let selectedTechnician;

        switch (config.strategy) {
            case 'random':
                selectedTechnician = technicians[Math.floor(Math.random() * technicians.length)];
                break;
            case 'least_busy':
                // TODO: Implement logic to find least busy technician
                selectedTechnician = technicians[0];
                break;
            case 'highest_rated':
                // TODO: Implement logic based on feedback ratings
                selectedTechnician = technicians[0];
                break;
            default:
                selectedTechnician = technicians[0];
        }

        data.assignedTechnician = selectedTechnician._id;
        data.assignedAt = new Date();
        data.status = 'Assigned';
        data.statusHistory.push({
            status: 'Assigned',
            timestamp: new Date(),
            notes: `Auto-assigned to ${selectedTechnician.name}`
        });

        await data.save();
        console.log(`Technician ${selectedTechnician.name} auto-assigned to booking ${data.bookingId}`);
    } catch (err) {
        console.error('Error auto-assigning technician:', err);
        throw err;
    }
}

/**
 * Generate invoice action
 */
async function generateInvoice(config, data) {
    try {
        const Invoice = require('../models/Invoice');
        const { generateInvoiceId } = require('./idGenerator');

        // Check if invoice already exists
        const existingInvoice = await Invoice.findOne({ bookingId: data._id });
        if (existingInvoice) {
            console.log('Invoice already exists for this booking');
            return;
        }

        // Populate booking data
        await data.populate(['userId', 'serviceId', 'packageId', 'addressId']);

        const invoiceId = await generateInvoiceId();

        const items = [{
            description: `${data.serviceId.name} - ${data.packageId.name}`,
            quantity: 1,
            unitPrice: data.basePrice,
            total: data.basePrice
        }];

        const addr = data.addressId;
        const customerAddress = `${addr.flatNo ? addr.flatNo + ', ' : ''}${addr.building ? addr.building + ', ' : ''}${addr.street}, ${addr.landmark ? addr.landmark + ', ' : ''}${addr.city}, ${addr.state} - ${addr.pincode}`;

        const invoice = new Invoice({
            invoiceId,
            bookingId: data._id,
            userId: data.userId._id,
            invoiceDate: new Date(),
            dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            items,
            subtotal: data.basePrice,
            taxRate: config.taxRate || 18,
            taxAmount: data.taxes,
            discount: data.discount,
            totalAmount: data.totalAmount,
            paymentStatus: 'Unpaid',
            paidAmount: 0,
            customerName: data.userId.name,
            customerPhone: data.userId.phone,
            customerEmail: data.userId.email,
            customerAddress
        });

        await invoice.save();
        console.log(`Invoice ${invoiceId} generated for booking ${data.bookingId}`);
    } catch (err) {
        console.error('Error generating invoice:', err);
        throw err;
    }
}

/**
 * Request feedback action
 */
async function requestFeedback(config, data) {
    try {
        // Send notification to user requesting feedback
        await sendPushNotification({
            title: 'How was your service?',
            body: 'Please share your feedback about the service you received',
            data: {
                action: 'open_feedback_form',
                bookingId: data._id.toString()
            }
        }, data);

        console.log('Feedback request sent');
    } catch (err) {
        console.error('Error requesting feedback:', err);
        throw err;
    }
}

/**
 * Send payment reminder action
 */
async function sendPaymentReminder(config, data) {
    try {
        await sendPushNotification({
            title: 'Payment Reminder',
            body: `Please pay ₹${data.totalAmount} for your completed service`,
            data: {
                action: 'open_payment',
                bookingId: data._id.toString()
            }
        }, data);

        console.log('Payment reminder sent');
    } catch (err) {
        console.error('Error sending payment reminder:', err);
        throw err;
    }
}

/**
 * Interpolate template strings with data
 * @param {String} template - Template string with {{placeholders}}
 * @param {Object} data - Data object
 * @returns {String} - Interpolated string
 */
function interpolate(template, data) {
    if (!template) return '';

    return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
        return getNestedValue(data, path.trim()) || match;
    });
}

/**
 * Ensure common references are populated
 */
async function ensurePopulated(data) {
    if (!data) return;

    try {
        const modelName = data.constructor.modelName;

        if (modelName === 'Booking') {
            await data.populate([
                { path: 'userId', select: 'name email phone' },
                { path: 'serviceId', select: 'name category' },
                { path: 'packageId', select: 'name price' },
                { path: 'addressId' },
                { path: 'assignedTechnician', select: 'name phone email' }
            ]);
        } else if (modelName === 'Payment') {
            await data.populate([
                { path: 'bookingId', populate: { path: 'userId serviceId packageId' } },
                { path: 'userId', select: 'name email phone' },
                { path: 'codCollectedBy', select: 'name phone' }
            ]);
        } else if (modelName === 'Feedback') {
            await data.populate([
                { path: 'bookingId', populate: { path: 'assignedTechnician' } },
                { path: 'userId', select: 'name email' },
                { path: 'serviceId', select: 'name' },
                { path: 'technicianId', select: 'name' }
            ]);
        }
    } catch (err) {
        console.warn('Error populating data for automation:', err.message);
    }
}

module.exports = {
    triggerAutomation,
    executeAction
};
