const admin = require('firebase-admin');
const User = require('../models/User');
const NotificationLog = require('../models/NotificationLog');

// Initialize Firebase Admin if not already initialized
try {
    if (!admin.apps.length) {
        const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
            ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
            : require('../serviceAccountKey.json');

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("Firebase Admin Initialized in Helper");
    }
} catch (e) {
    console.warn("Firebase Init Failed in Helper: Ensure serviceAccountKey.json exists or FIREBASE_SERVICE_ACCOUNT env is set.", e.message);
}

/**
 * Send a direct push notification to a user via their FCM token
 */
async function sendUserNotification(userId, title, body, data = {}) {
    try {
        const user = await User.findById(userId);
        if (!user) return false;

        // ✅ LOG TO DATABASE (Persistent History - always record so user sees it in notifications center)
        await NotificationLog.create({
            userId: user._id,
            title,
            body,
            data,
            imageUrl: data.imageUrl || undefined
        }).catch(err => console.error('[NotificationLog] Failed to record log:', err));

        if (!user.fcmToken) {
            console.log(`Push skipped (No FCM token for user ${userId}).`);
            
            // Email fallback for order / booking notifications
            if (user.email && (title.includes('Order') || title.includes('Booking') || data.orderId || data.bookingId)) {
                try {
                    const mailer = require('../routes/mailer');
                    await mailer.sendMail({
                        to: user.email,
                        subject: title,
                        text: body,
                        html: `<div style="font-family:sans-serif;padding:20px;border-radius:10px;background:#f9fafb;border:1px solid #e5e7eb;">
                            <h2 style="color:#1e3a8a;margin-top:0;">${title}</h2>
                            <p style="color:#374151;font-size:15px;line-height:1.5;">${body}</p>
                            <p style="color:#9ca3af;font-size:12px;margin-top:20px;">WattOrbit Energy • Automated Notification</p>
                        </div>`
                    });
                    console.log(`[Notification Fallback] Email sent to ${user.email}`);
                } catch (mErr) {
                    console.warn(`[Notification Fallback] Email fallback failed:`, mErr.message);
                }
            }
            return false;
        }

        const message = {
            notification: {
                title,
                body
            },
            data: {
                ...data,
                click_action: 'FLUTTER_NOTIFICATION_CLICK' // For mobile compatibility
            },
            token: user.fcmToken
        };

        const response = await admin.messaging().send(message);
        console.log(`Successfully sent notification to ${user.name || user.username}:`, response);
        return true;
    } catch (err) {
        // Gracefully handle 'NotRegistered' or invalid tokens to prevent log spam and retry attempts
        if (err.code === 'messaging/registration-token-not-registered' || err.code === 'messaging/invalid-registration-token') {
            console.warn(`[FCM] Token for user ${userId} is invalid or expired. Removing from database.`);
            await User.findByIdAndUpdate(userId, { $unset: { fcmToken: "" } });
            return false;
        }

        console.error('Error sending user notification:', err);
        return false;
    }
}

/**
 * Send a notification to a topic (e.g., 'admin', 'technician', 'all')
 */
async function sendTopicNotification(topic, title, body, data = {}) {
    try {
        const message = {
            notification: {
                title,
                body
            },
            data: {
                ...data,
                click_action: 'FLUTTER_NOTIFICATION_CLICK'
            },
            topic: topic
        };

        const response = await admin.messaging().send(message);
        console.log(`Successfully sent notification to topic '${topic}':`, response);

        // ✅ LOG TO DATABASE (Persistent History for all users in topic)
        // If topic is 'all', 'admin', 'technician' etc., we find relevant users and log
        if (['all', 'admin', 'technician', 'engineer', 'organisation', 'employee'].includes(topic)) {
            const query = topic === 'all' ? {} : { role: topic };
            const users = await User.find(query).select('_id');
            const logs = users.map(u => ({
                userId: u._id,
                title,
                body,
                data,
                imageUrl: data.imageUrl || undefined
            }));
            if (logs.length > 0) {
                await NotificationLog.insertMany(logs);
            }
        }

        return true;
    } catch (err) {
        console.error(`Error sending notification to topic '${topic}':`, err);
        return false;
    }
}

/**
 * Standardized Material Order Lifecycle Notifications (Push + SMS + Email Fallback)
 */
async function sendOrderLifecycleNotification(order, eventType, extraData = {}) {
    try {
        const userId = order.userId?._id || order.userId;
        const customerName = order.userId?.name || 'Customer';
        const orderId = order.orderId;
        const totalAmount = order.totalAmount;
        const partner = extraData.partner || order.deliveryPartner || 'Courier';
        const tracking = extraData.trackingId || order.trackingId || order.awbNumber || '';
        const partnerPhone = extraData.partnerPhone || order.deliveryPartnerContact || '';

        let title = '';
        let body = '';

        switch (eventType) {
            case 'ORDER_CONFIRMED':
                title = `Order Confirmed! (#${orderId})`;
                body = `Your order for ₹${totalAmount} has been placed successfully and is being prepared.`;
                break;
            case 'ORDER_PROCESSING':
                title = `Order Packed (#${orderId})`;
                body = `Your items are packed and awaiting courier dispatch.`;
                break;
            case 'ORDER_DISPATCHED':
                title = `Order Dispatched! (#${orderId})`;
                body = `Shipped via ${partner}${tracking ? `. Tracking/AWB: ${tracking}` : ''}.`;
                break;
            case 'OUT_FOR_DELIVERY':
                title = `Out for Delivery! (#${orderId})`;
                body = `Your package is arriving today via ${partner}${partnerPhone ? ` (${partnerPhone})` : ''}.`;
                break;
            case 'ORDER_DELIVERED':
                title = `Order Delivered! (#${orderId})`;
                body = `Your order has been delivered. Tap to view details and download invoice.`;
                break;
            case 'ORDER_CANCELLED':
                title = `Order Cancelled (#${orderId})`;
                body = `Your order #${orderId} has been cancelled successfully.`;
                break;
            default:
                title = `Order Update (#${orderId})`;
                body = `Your order status has been updated to ${order.status}.`;
        }

        // 1. Send In-App & FCM Push Notification (with Brevo email fallback)
        await sendUserNotification(userId, title, body, {
            type: eventType,
            orderId: order._id.toString(),
            status: order.status,
            ...extraData
        });

        // 2. Dispatch SMS via Fast2SMS
        const smsHelper = require('./smsHelper');
        if (eventType === 'ORDER_CONFIRMED') {
            await smsHelper.sendOrderConfirmedSms(userId, customerName, orderId, totalAmount).catch(() => {});
        } else if (eventType === 'ORDER_DISPATCHED') {
            await smsHelper.sendOrderDispatchedSms(userId, customerName, orderId, partner, tracking).catch(() => {});
        } else if (eventType === 'OUT_FOR_DELIVERY') {
            await smsHelper.sendOrderOutForDeliverySms(userId, customerName, orderId, partner, partnerPhone).catch(() => {});
        } else if (eventType === 'ORDER_DELIVERED') {
            await smsHelper.sendOrderDeliveredSms(userId, customerName, orderId).catch(() => {});
        } else if (eventType === 'ORDER_CANCELLED') {
            await smsHelper.sendOrderCancelledSms(userId, customerName, orderId).catch(() => {});
        }

        return true;
    } catch (err) {
        console.error('[Order Notification] Error:', err.message);
        return false;
    }
}

module.exports = {
    sendUserNotification,
    sendTopicNotification,
    sendOrderLifecycleNotification
};
