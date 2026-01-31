const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const User = require('./models/User');

async function checkTechs() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to DB');

        const techs = await User.find({ role: 'technician' });
        console.log(`Found ${techs.length} technicians:`);
        techs.forEach(t => {
            console.log(`- ID: ${t._id}, Name: ${t.name}, Username: ${t.username}, Approved: ${t.isApproved}, Org: ${t.organisationId}`);
        });

        const allUsers = await User.find({});
        console.log(`\nTotal users in DB: ${allUsers.length}`);
        const roles = {};
        allUsers.forEach(u => {
            roles[u.role] = (roles[u.role] || 0) + 1;
        });
        console.log('Role counts:', roles);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkTechs();
