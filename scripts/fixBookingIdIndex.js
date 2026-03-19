/**
 * Migration: Fix bookingId index to be sparse
 *
 * Problem: The original bookingId_1 index was created without `sparse: true`.
 * This means multiple documents with bookingId: null (online payment bookings)
 * violate the unique constraint.
 *
 * Fix: Drop the old index. Mongoose will recreate it as a sparse unique index
 * on the next server start (as defined in Booking.js schema).
 *
 * Run once with: node scripts/fixBookingIdIndex.js
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/wcrm_dev';

async function run() {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected');

    const db = mongoose.connection.db;
    const collection = db.collection('bookings');

    // List existing indexes for visibility
    const existingIndexes = await collection.indexes();
    console.log('📋 Current indexes on bookings collection:');
    existingIndexes.forEach(idx => console.log(' -', JSON.stringify(idx)));

    // Check if the non-sparse index exists
    const badIndex = existingIndexes.find(
        idx => idx.name === 'bookingId_1' && !idx.sparse
    );

    if (badIndex) {
        console.log('\n⚠️  Found non-sparse bookingId_1 index. Dropping it...');
        await collection.dropIndex('bookingId_1');
        console.log('✅ Dropped bookingId_1 index.');
        console.log('ℹ️  Mongoose will recreate it as a sparse unique index on next server start.');
    } else {
        const sparseIndex = existingIndexes.find(
            idx => idx.name === 'bookingId_1' && idx.sparse
        );
        if (sparseIndex) {
            console.log('\n✅ bookingId_1 index is already sparse. No action needed.');
        } else {
            console.log('\nℹ️  bookingId_1 index not found at all. Mongoose will create it fresh on next server start.');
        }
    }

    await mongoose.disconnect();
    console.log('🔌 Disconnected. Migration complete.');
}

run().catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
