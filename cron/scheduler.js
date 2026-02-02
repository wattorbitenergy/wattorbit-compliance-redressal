const cron = require('node-cron');
const Booking = require('../models/Booking');
const Feedback = require('../models/Feedback');
const { triggerAutomation } = require('../utils/automationEngine');

/**
 * Initialize all cron jobs
 */
const initCronJobs = () => {
    console.log('Initializing Cron Jobs...');

    // Feedback Reminder Job - Runs every hour
    cron.schedule('0 * * * *', async () => {
        try {
            const Config = require('../models/Config');
            const cronConfig = await Config.findOne({ key: 'cron_enabled' });

            // Default to true if not set, or check explicit value
            const isEnabled = cronConfig ? cronConfig.value : true;

            if (!isEnabled) {
                console.log('Feedback Reminder Job skipped: Cron is disabled in config.');
                return;
            }

            console.log('Running Feedback Reminder Job...');
            // Find bookings completed > 2 days ago, no feedback sent
            const twoDaysAgo = new Date();
            twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

            const bookings = await Booking.find({
                status: 'Completed',
                completedAt: { $lte: twoDaysAgo },
                feedbackReminderSent: false
            });

            console.log(`Found ${bookings.length} bookings eligible for feedback reminder.`);

            for (const booking of bookings) {
                // Double check if feedback already exists (in case race condition or manual check)
                const feedbackExists = await Feedback.exists({ bookingId: booking._id });

                if (feedbackExists) {
                    // Mark as sent so we don't check again
                    booking.feedbackReminderSent = true;
                    await booking.save();
                    continue;
                }

                // Trigger automation
                await triggerAutomation('feedback.reminder', booking);

                // Mark as sent
                booking.feedbackReminderSent = true;
                await booking.save();

                console.log(`Feedback reminder triggered for booking ${booking.bookingId}`);
            }
        } catch (err) {
            console.error('Error in Feedback Reminder Job:', err);
        }
    });

    console.log('Cron Jobs Initialized.');
};

module.exports = initCronJobs;
