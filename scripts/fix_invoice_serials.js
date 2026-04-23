const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Invoice = require('../models/Invoice');
const User = require('../models/User');
const Service = require('../models/Service');
const ServicePackage = require('../models/ServicePackage');
const Address = require('../models/Address');
const Counter = require('../models/Counter');
require('dotenv').config();

/**
 * This script fixes invoice serial numbers after the accidental re-generation.
 * 
 * Problem: The previous script deleted ALL 18 AC invoices (including 13 that already existed)
 * and re-generated them all with new serial numbers (INV-2026-047 to INV-2026-064).
 * 
 * Fix strategy:
 * 1. Find ALL current invoices and identify which IDs are occupied (non-AC invoices)
 * 2. Identify the 5 bookings that were recently completed (the ones that needed new invoices)
 *    vs the 13 bookings that were completed earlier (had old invoices)
 * 3. Re-assign old serial numbers to the 13 old bookings (in order of completedAt)
 * 4. Assign the 5 new ones with sequential IDs after the old ones
 * 5. Reset the counter to the correct value
 */

async function run() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to database');

        // Step 1: Find the AC service
        const acService = await Service.findOne({ name: /AC/i });
        if (!acService) { console.error('AC Service not found'); return; }
        console.log(`AC Service: ${acService.name} (${acService._id})`);

        // Step 2: Get ALL invoices currently in the system
        const allInvoices = await Invoice.find({}).sort({ invoiceId: 1 }).lean();
        console.log(`Total invoices in DB: ${allInvoices.length}`);

        // Step 3: Find all completed AC bookings
        const acBookings = await Booking.find({
            status: 'Completed',
            serviceId: acService._id
        }).sort({ completedAt: 1 }).lean();
        console.log(`Completed AC bookings: ${acBookings.length}`);

        const acBookingIds = new Set(acBookings.map(b => b._id.toString()));

        // Step 4: Separate AC invoices from non-AC invoices
        const acInvoices = allInvoices.filter(inv => acBookingIds.has(inv.bookingId.toString()));
        const nonAcInvoices = allInvoices.filter(inv => !acBookingIds.has(inv.bookingId.toString()));

        console.log(`AC invoices (current): ${acInvoices.length}`);
        console.log(`Non-AC invoices: ${nonAcInvoices.length}`);

        // Step 5: Identify which serial numbers are taken by non-AC invoices
        // Parse serial numbers from non-AC invoices
        const takenSerials = new Set();
        nonAcInvoices.forEach(inv => {
            const match = inv.invoiceId.match(/INV-2026-(\d+)/);
            if (match) takenSerials.add(parseInt(match[1]));
        });
        console.log(`Serial numbers taken by non-AC invoices: ${[...takenSerials].sort((a,b) => a-b).join(', ')}`);

        // Step 6: Identify the 5 recently-completed bookings (from today's pricing update)
        // These are the ones that were completed after the pricing update script ran
        // The pricing update was done on 2026-04-23 ~06:54 UTC
        // Look at status history for "Pricing updated" note
        const recentlyCompletedIds = new Set();
        
        // The 5 bookings that had NO invoices before our first run were:
        // BKG-2026-0060, BKG-2026-0059, BKG-2026-0041, BKG-2026-0049, BKG-2026-0058
        // These were the ones generated in the FIRST run (before re-generation)
        const recentBookingIds = ['BKG-2026-0060', 'BKG-2026-0059', 'BKG-2026-0041', 'BKG-2026-0049', 'BKG-2026-0058'];
        acBookings.forEach(b => {
            if (recentBookingIds.includes(b.bookingId)) {
                recentlyCompletedIds.add(b._id.toString());
            }
        });

        // Step 7: Split AC bookings into "old" (had invoices before) and "new" (recently completed, no invoice)
        const oldBookings = acBookings.filter(b => !recentlyCompletedIds.has(b._id.toString()));
        const newBookings = acBookings.filter(b => recentlyCompletedIds.has(b._id.toString()));

        console.log(`\nOld bookings (need original serial restored): ${oldBookings.length}`);
        oldBookings.forEach(b => console.log(`  - ${b.bookingId} (completed: ${b.completedAt})`));
        console.log(`New bookings (need fresh serial): ${newBookings.length}`);
        newBookings.forEach(b => console.log(`  - ${b.bookingId} (completed: ${b.completedAt})`));

        // Step 8: Find available serial numbers for old bookings (fill gaps before non-AC invoices)
        // Old bookings should get the lowest available serial numbers (they were created first)
        let nextSerial = 1;
        const oldSerialAssignments = [];

        for (const booking of oldBookings) {
            // Find next available serial
            while (takenSerials.has(nextSerial)) {
                nextSerial++;
            }
            oldSerialAssignments.push({
                bookingId: booking._id,
                bookingIdStr: booking.bookingId,
                serial: nextSerial,
                invoiceId: `INV-2026-${String(nextSerial).padStart(3, '0')}`
            });
            takenSerials.add(nextSerial);
            nextSerial++;
        }

        // Step 9: Assign serials for new bookings (after old ones)
        const newSerialAssignments = [];
        for (const booking of newBookings) {
            while (takenSerials.has(nextSerial)) {
                nextSerial++;
            }
            newSerialAssignments.push({
                bookingId: booking._id,
                bookingIdStr: booking.bookingId,
                serial: nextSerial,
                invoiceId: `INV-2026-${String(nextSerial).padStart(3, '0')}`
            });
            takenSerials.add(nextSerial);
            nextSerial++;
        }

        console.log('\n--- Serial Assignments ---');
        console.log('OLD bookings (restored):');
        oldSerialAssignments.forEach(a => console.log(`  ${a.bookingIdStr} → ${a.invoiceId}`));
        console.log('NEW bookings (fresh):');
        newSerialAssignments.forEach(a => console.log(`  ${a.bookingIdStr} → ${a.invoiceId}`));

        // Step 10: Apply the changes
        const allAssignments = [...oldSerialAssignments, ...newSerialAssignments];
        
        for (const assignment of allAssignments) {
            const result = await Invoice.updateOne(
                { bookingId: assignment.bookingId },
                { $set: { invoiceId: assignment.invoiceId } }
            );
            if (result.modifiedCount > 0) {
                console.log(`✅ ${assignment.bookingIdStr} → ${assignment.invoiceId}`);
            } else {
                console.log(`⚠️  No invoice found for ${assignment.bookingIdStr}`);
            }
        }

        // Step 11: Reset the counter to the highest used serial
        const maxSerial = Math.max(...[...takenSerials]);
        await Counter.findByIdAndUpdate(
            'invoice-2026',
            { seq: maxSerial },
            { upsert: true }
        );
        console.log(`\n✅ Counter reset to ${maxSerial} (next invoice will be INV-2026-${String(maxSerial + 1).padStart(3, '0')})`);

        // Final verification
        const finalInvoices = await Invoice.find({}).sort({ invoiceId: 1 }).lean();
        console.log(`\n--- Final Invoice List (${finalInvoices.length} total) ---`);
        for (const inv of finalInvoices) {
            const booking = await Booking.findById(inv.bookingId).select('bookingId').lean();
            console.log(`${inv.invoiceId} → ${booking?.bookingId || 'UNKNOWN'} (${inv.paymentStatus})`);
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await mongoose.disconnect();
    }
}

run();
