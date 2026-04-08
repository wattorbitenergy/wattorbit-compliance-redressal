const mailer = require('../routes/mailer');
const Config = require('../models/Config');
const { generateInvoicePDF } = require('./invoicePDFGenerator');

/**
 * Helper to fetch social links for email footer
 */
async function getSocialLinks() {
    try {
        const keys = ['social_fb', 'social_insta', 'social_yt', 'social_wa', 'social_x', 'social_li', 'social_email'];
        const configs = await Config.find({ key: { $in: keys } });
        const map = {};
        configs.forEach(c => map[c.key] = c.value);
        
        return {
            fb: map.social_fb || "https://www.facebook.com/profile.php?id=61578413404699",
            insta: map.social_insta || "https://www.instagram.com/wattorbit/",
            yt: map.social_yt || "https://youtube.com/@wattorbit?si=YGaOIvzSIlUElKY8",
            wa: map.social_wa || "",
            x: map.social_x || "",
            li: map.social_li || "",
            email: map.social_email || "support@wattorbit.in"
        };
    } catch (err) {
        return {
            fb: "https://www.facebook.com/profile.php?id=61578413404699",
            insta: "https://www.instagram.com/wattorbit/",
            yt: "https://youtube.com/@wattorbit?si=YGaOIvzSIlUElKY8",
            email: "support@wattorbit.in"
        };
    }
}

async function getEmailFooter() {
    const links = await getSocialLinks();
    
    let socialButtons = '';
    
    const platforms = [
        { key: 'wa', label: 'WhatsApp', color: '#25D366', link: links.wa },
        { key: 'fb', label: 'Facebook', color: '#1877F2', link: links.fb },
        { key: 'x', label: 'X', color: '#000000', link: links.x },
        { key: 'li', label: 'LinkedIn', color: '#0A66C2', link: links.li },
        { key: 'yt', label: 'YouTube', color: '#FF0000', link: links.yt },
        { key: 'insta', label: 'Instagram', color: '#E4405F', link: links.insta },
        { key: 'email', label: 'Email', color: '#14A1BD', link: links.email.startsWith('mailto:') ? links.email : `mailto:${links.email}` },
    ];

    platforms.forEach(p => {
        if (p.link) {
            socialButtons += `
                <a href="${p.link}" style="display: inline-block; background-color: ${p.color}; color: #ffffff; padding: 8px 12px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 4px; font-size: 11px;">
                    ${p.label}
                </a>
            `;
        }
    });

    return `
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #777; font-size: 12px;">
            <p>Best Regards,<br><strong>Team WattOrbit</strong></p>
            <div style="margin-top: 20px;">
                ${socialButtons}
            </div>
            <p style="margin-top: 20px;">WATTORBIT ENERGY SOLUTIONS LLP | <a href="https://wattorbit.in" style="color: #007bff; text-decoration: none;">wattorbit.in</a></p>
        </div>
    `;
}


/**
 * Send Welcome Email to newly registered users
 */
async function sendWelcomeEmail(user) {
    if (!user.email) return;

    const html = `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            <h2 style="color: #007bff; text-align: center;">Welcome to WattOrbit!</h2>
            <p>Dear <strong>${user.name || user.username}</strong>,</p>
            <p>We are thrilled to have you join the WattOrbit family. Our mission is to provide you with seamless electrical, plumbing, and home maintenance services at your fingertips.</p>
            <p>With your new account, you can:</p>
            <ul>
                <li>Book expert services in seconds</li>
                <li>Track your service status in real-time</li>
                <li>Access all your service history and invoices</li>
            </ul>
            <p>Login now to explore: <a href="https://wattorbit.in/login" style="color: #007bff;">wattorbit.in/login</a></p>
            ${await getEmailFooter()}
        </div>
    `;

    try {
        await mailer.sendMail({
            to: user.email,
            subject: 'Welcome to WattOrbit! 🚀',
            html,
            from: "Welcome@wattorbit.in"
        });
        console.log(`[Email] Welcome email sent to ${user.email}`);
    } catch (err) {
        console.error(`[Email] Failed to send welcome email to ${user.email}:`, err.message);
    }
}

/**
 * Send Booking Created Email
 */
async function sendBookingCreatedEmail(user, booking, serviceName) {
    if (!user.email) return;

    // Global toggle check
    try {
        const globalEmailConfig = await Config.findOne({ key: 'enable_email' });
        if (globalEmailConfig && globalEmailConfig.value === false) {
            console.log('[Email] Booking Created Skipped: Global email notifications are disabled.');
            return false;
        }
    } catch (err) {
        console.error('[Email] Error checking global toggle:', err.message);
    }

    const html = `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            <h2 style="color: #28a745; text-align: center;">Booking Confirmed!</h2>
            <p>Dear <strong>${user.name || user.username}</strong>,</p>
            <p>Your service request has been received successfully.</p>
            <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p><strong>Booking ID:</strong> ${booking.bookingId}</p>
                <p><strong>Service:</strong> ${serviceName}</p>
                <p><strong>Status:</strong> Pending Confirmation</p>
            </div>
            <p>Our team will assign a technician to your request shortly. You will be notified as soon as someone is on the way.</p>
            ${await getEmailFooter()}
        </div>
    `;

    try {
        await mailer.sendMail({
            to: user.email,
            subject: `Service Booking Confirmed: ${booking.bookingId}`,
            html,
            from: "booking@wattorbit.in"
        });
        console.log(`[Email] Booking confirmation sent to ${user.email}`);
    } catch (err) {
        console.error(`[Email] Failed to send booking email to ${user.email}:`, err.message);
    }
}

/**
 * Send Technician Assigned Email
 */
async function sendTechnicianAssignedEmail(user, technician, booking) {
    if (!user.email) return;

    // Global toggle check
    try {
        const globalEmailConfig = await Config.findOne({ key: 'enable_email' });
        if (globalEmailConfig && globalEmailConfig.value === false) {
            console.log('[Email] Tech Assigned Skipped: Global email notifications are disabled.');
            return false;
        }
    } catch (err) {
        console.error('[Email] Error checking global toggle:', err.message);
    }

    const html = `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            <h2 style="color: #007bff; text-align: center;">Technician Assigned</h2>
            <p>Dear <strong>${user.name || user.username}</strong>,</p>
            <p>An expert has been assigned to your service request <strong>${booking.bookingId}</strong>.</p>
            <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 5px solid #007bff;">
                <p><strong>Technician Name:</strong> ${technician.name}</p>
                <p><strong>Contact:</strong> ${technician.phone || 'Available in app'}</p>
            </div>
            <p>The technician will arrive at your location shortly. You can track their status on the WattOrbit app.</p>
            ${await getEmailFooter()}
        </div>
    `;

    try {
        await mailer.sendMail({
            to: user.email,
            subject: `Technician Assigned for Booking: ${booking.bookingId}`,
            html,
            from: "booking@wattorbit.in"
        });
        console.log(`[Email] Tech assignment email sent to ${user.email}`);
    } catch (err) {
        console.error(`[Email] Failed to send assignment email to ${user.email}:`, err.message);
    }
}

/**
 * Send Job Completed Email with Invoice Attachment
 */
async function sendJobCompletedEmail(user, booking, invoice) {
    if (!user.email) return;

    // Global toggle check
    try {
        const globalEmailConfig = await Config.findOne({ key: 'enable_email' });
        if (globalEmailConfig && globalEmailConfig.value === false) {
            console.log('[Email] Skipped completions: Global email notifications are disabled.');
            return false;
        }
    } catch (err) {
        console.error('[Email] Error checking global toggle:', err.message);
    }

    const html = `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            <h2 style="color: #28a745; text-align: center;">Service Completed!</h2>
            <p>Dear <strong>${user.name || user.username}</strong>,</p>
            <p>Your service request <strong>${booking.bookingId}</strong> has been successfully completed.</p>
            <p>We hope you are satisfied with the service provided. <b>Your invoice has been attached to this email</b> and is also available in your account.</p>
            <div style="text-align: center; margin: 25px 0;">
                <p><strong>Please rate our technician in the app!</strong></p>
                <p>Your feedback helps us maintain our high service standards.</p>
            </div>
            <p>If you have any concerns, feel free to reach out to us at <a href="mailto:support@wattorbit.in" style="color: #007bff;">support@wattorbit.in</a></p>
            ${await getEmailFooter()}
        </div>
    `;

    try {
        const mailOptions = {
            to: user.email,
            subject: `Service Completed: ${booking.bookingId} - Thank You!`,
            html
        };

        // Attach invoice if provided
        if (invoice) {
            const pdfBuffer = await generateInvoicePDF(invoice, { buffer: true });
            mailOptions.attachments = [
                {
                    ContentType: "application/pdf",
                    Filename: `Invoice-${invoice.invoiceId}.pdf`,
                    Base64Content: pdfBuffer.toString('base64')
                }
            ];
        }

        mailOptions.from = "booking@wattorbit.in";
        await mailer.sendMail(mailOptions);
        console.log(`[Email] Completion email sent to ${user.email} (Attached: ${!!invoice})`);
    } catch (err) {
        console.error(`[Email] Failed to send completion email to ${user.email}:`, err.message);
    }
}

/**
 * 5. Service Request OTP Email
 */
async function sendServiceRequestOTPEmail(user, otp) {
    if (!user.email) return;

    const html = `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            <h2 style="color: #007bff; text-align: center;">Service Request Verification</h2>
            <p>Dear <strong>${user.name || user.username}</strong>,</p>
            <p>A service request is being created for you. To confirm your consent, please use the following OTP:</p>
            <div style="text-align: center; margin: 30px 0;">
                <span style="font-size: 32px; font-weight: bold; padding: 10px 30px; background: #f0f7ff; color: #007bff; border-radius: 10px; border: 2px dashed #007bff; letter-spacing: 5px;">
                    ${otp}
                </span>
            </div>
            <p style="color: #777; font-size: 13px;">This OTP is valid for 10 minutes. If you did not request this service, please ignore this email.</p>
            ${await getEmailFooter()}
        </div>
    `;

    try {
        await mailer.sendMail({
            to: user.email,
            subject: 'Verify your WattOrbit Service Request ⚡',
            html,
            from: "otp@wattorbit.in"
        });
        console.log(`[Email] Service OTP sent to ${user.email}`);
    } catch (err) {
        console.error(`[Email] Failed to send service OTP to ${user.email}:`, err.message);
    }
}

/**
 * 6. Booking Cancelled Email
 */
async function sendBookingCancelledEmail(user, booking) {
    if (!user.email) return;

    // Global toggle check
    try {
        const globalEmailConfig = await Config.findOne({ key: 'enable_email' });
        if (globalEmailConfig && globalEmailConfig.value === false) {
            console.log('[Email] Booking Cancelled Skipped: Global email notifications are disabled.');
            return false;
        }
    } catch (err) {
        console.error('[Email] Error checking global toggle:', err.message);
    }

    const html = `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            <h2 style="color: #dc3545; text-align: center;">Booking Cancelled</h2>
            <p>Dear <strong>${user.name || user.username}</strong>,</p>
            <p>As per your request (or administrative action), your service booking <strong>${booking.bookingId}</strong> has been cancelled.</p>
            <div style="background: #fff5f5; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 5px solid #dc3545;">
                <p><strong>Booking ID:</strong> ${booking.bookingId}</p>
                <p><strong>Reason:</strong> ${booking.cancellationReason || 'Not specified'}</p>
            </div>
            <p>If any refund was due, it has been automatically processed to your wallet.</p>
            <p>We're sorry to see this go. If this was a mistake, you can book again anytime on the app.</p>
            ${await getEmailFooter()}
        </div>
    `;

    try {
        await mailer.sendMail({
            to: user.email,
            subject: `Booking Cancelled: ${booking.bookingId}`,
            html,
            from: "booking@wattorbit.in"
        });
        console.log(`[Email] Cancellation email sent to ${user.email}`);
    } catch (err) {
        console.error(`[Email] Failed to send cancellation email to ${user.email}:`, err.message);
    }
}

/**
 * Send a short alert email to the WattOrbit admin
 * Admin email is sourced from Config key 'admin_email', then ADMIN_EMAIL env var, then support@wattorbit.in
 * @param {string} subject - Email subject
 * @param {string} html - HTML body
 */
async function sendAdminAlertEmail(subject, html) {
    try {
        let adminEmail = process.env.ADMIN_EMAIL || 'support@wattorbit.in';
        try {
            const cfg = await Config.findOne({ key: 'admin_email' });
            if (cfg && cfg.value) adminEmail = cfg.value;
        } catch (_) { /* ignore config fetch errors */ }

        await mailer.sendMail({
            to: adminEmail,
            subject,
            html,
            from: 'alerts@wattorbit.in'
        });
        console.log(`[Email] Admin alert sent → ${adminEmail} | ${subject}`);
    } catch (err) {
        console.error('[Email] Failed to send admin alert:', err.message);
    }
}

module.exports = {
    sendWelcomeEmail,
    sendBookingCreatedEmail,
    sendTechnicianAssignedEmail,
    sendJobCompletedEmail,
    sendServiceRequestOTPEmail,
    sendBookingCancelledEmail,
    sendAdminAlertEmail
};
