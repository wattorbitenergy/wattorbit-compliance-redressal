const https = require('https');
const User = require('../models/User');

const API_KEY = process.env.FAST2SMS_API_KEY;

/**
 * Core function to send an SMS via Fast2SMS DLT API.
 * @param {string} phone - Recipient phone number (10 digits)
 * @param {string} messageId - The numeric DLT Message ID from Fast2SMS DLT Manager
 * @param {string} variablesValues - Pipe separated values for variables (e.g. "Value1|Value2")
 * @param {string} senderId - DLT Sender ID (e.g., WTORBT or WATORB)
 */
async function sendSMS(phone, messageId, variablesValues = '', senderId = 'WATORB') {
    if (!API_KEY) {
        console.warn('[SMS] Skipped: FAST2SMS_API_KEY not set in environment.');
        return false;
    }

    if (!messageId) {
        console.warn('[SMS] Skipped: No Message ID provided.');
        return false;
    }

    // Normalize phone: strip country code, keep last 10 digits
    const normalizedPhone = String(phone).replace(/\D/g, '').slice(-10);
    if (normalizedPhone.length !== 10) {
        console.warn(`[SMS] Skipped: Invalid phone number "${phone}"`);
        return false;
    }

    const payloadObj = {
        route: 'dlt',
        sender_id: senderId,
        message: messageId,
        language: 'english',
        flash: 0,
        numbers: normalizedPhone
    };

    if (variablesValues) {
        payloadObj.variables_values = variablesValues;
    }

    const payload = JSON.stringify(payloadObj);

    return new Promise((resolve) => {
        const options = {
            hostname: 'www.fast2sms.com',
            path: '/dev/bulkV2',
            method: 'POST',
            headers: {
                authorization: API_KEY,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                'cache-control': 'no-cache'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.return === true) {
                        console.log(`[SMS] Sent to ${normalizedPhone} via ${senderId} (Template: ${messageId})`);
                        resolve(true);
                    } else {
                        console.error(`[SMS] Fast2SMS Error:`, parsed);
                        resolve(false);
                    }
                } catch {
                    console.error('[SMS] Failed to parse response:', data);
                    resolve(false);
                }
            });
        });

        req.on('error', (err) => {
            console.error('[SMS] Request error:', err.message);
            resolve(false);
        });

        req.write(payload);
        req.end();
    });
}

/**
 * Check if a user has SMS notifications enabled.
 */
async function userHasSmsEnabled(userId) {
    try {
        const user = await User.findById(userId).select('smsNotificationsEnabled phone');
        if (!user || !user.phone) return false;
        return user.smsNotificationsEnabled !== false; 
    } catch {
        return false;
    }
}


/* ===================================================
   PRE-BUILT MESSAGE SENDERS using DLT Templates
=================================================== */

/**
 * 1. OTP SMS (Sender: WTORBT)
 * Template: Dear Customer, Your WattOrbit verification OTP is {#VAR#}. 
 *           Please do not share this OTP with anyone. Team WattOrbit
 */
async function sendOTPSms(phone, otp) {
    const templateId = process.env.FAST2SMS_OTP_TEMPLATE_ID;
    if (!templateId) {
        console.warn('[SMS] OTP skipped: FAST2SMS_OTP_TEMPLATE_ID missing in .env');
        return false;
    }
    return sendSMS(phone, templateId, otp, 'WTORBT');
}

/**
 * 2. Technician Assigned — to Customer (Sender: WATORB)
 * Template: Dear {#VAR#}, Your service request {#VAR#} has been assigned to technician {#VAR#}.
 *           Track your request on WattOrbit App. Team WattOrbit
 */
async function sendTechnicianAssignedSms(userId, customerName, bookingId, technicianName) {
    const templateId = process.env.FAST2SMS_ASSIGNED_TEMPLATE_ID;
    if (!templateId) return false;

    const enabled = await userHasSmsEnabled(userId);
    if (!enabled) return false;
    const user = await User.findById(userId).select('phone');
    if (!user?.phone) return false;

    // Fast2SMS expects variables in order: CustomerName|BookingID|TechnicianName
    const vars = `${customerName}|${bookingId}|${technicianName}`;
    return sendSMS(user.phone, templateId, vars, 'WATORB');
}

/**
 * 3. Service Completed — to Customer (Sender: WATORB)
 * Template: Dear {#VAR#}, Your service request {#VAR#} has been successfully completed. 
 *           Please rate our technician in app and give feedback at support@wattorbit.in
 *           Thank you for choosing WattOrbit Energy Solution.
 */
async function sendServiceCompletedSms(userId, customerName, bookingId) {
    const templateId = process.env.FAST2SMS_COMPLETED_TEMPLATE_ID;
    if (!templateId) return false;

    const enabled = await userHasSmsEnabled(userId);
    if (!enabled) return false;
    const user = await User.findById(userId).select('phone');
    if (!user?.phone) return false;

    // Variables: CustomerName|BookingID
    const vars = `${customerName}|${bookingId}`;
    return sendSMS(user.phone, templateId, vars, 'WATORB');
}

/**
 * 4. Booking Created — to Customer
 */
async function sendBookingCreatedSms(userId, customerName, bookingId, serviceName) {
    const templateId = process.env.FAST2SMS_BOOKING_CREATED_TEMPLATE_ID;
    if (!templateId) return false;

    const enabled = await userHasSmsEnabled(userId);
    if (!enabled) return false;
    const user = await User.findById(userId).select('phone');
    if (!user?.phone) return false;

    // Variables: CustomerName|BookingID|ServiceName
    const vars = `${customerName}|${bookingId}|${serviceName}`;
    return sendSMS(user.phone, templateId, vars, 'WATORB');
}

/**
 * 5. Job Assigned — to Technician
 */
async function sendJobAssignedToTechnicianSms(technicianId, technicianName, bookingId) {
    const templateId = process.env.FAST2SMS_JOB_ASSIGNED_TEMPLATE_ID;
    if (!templateId) return false;

    const tech = await User.findById(technicianId).select('phone');
    if (!tech?.phone) return false;

    // Variables: TechnicianName|BookingID
    const vars = `${technicianName}|${bookingId}`;
    return sendSMS(tech.phone, templateId, vars, 'WATORB');
}

module.exports = {
    sendSMS,
    sendOTPSms,
    sendTechnicianAssignedSms,
    sendServiceCompletedSms,
    sendBookingCreatedSms,
    sendJobAssignedToTechnicianSms
};
