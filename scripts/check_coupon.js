const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const Coupon = require('../models/Coupon');

async function checkCoupon() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const coupon = await Coupon.findOne({ code: 'COUPON10' });
        console.log('Coupon COUPON10 details:', coupon);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkCoupon();
