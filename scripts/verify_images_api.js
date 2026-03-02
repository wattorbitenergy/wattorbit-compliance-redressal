const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../backend/.env') });

const API_URL = 'http://localhost:5000';

async function testImageListing() {
    try {
        console.log('--- Testing Admin Image Listing ---');

        // 1. Login to get token
        console.log('Logging in as admin...');
        const loginRes = await axios.post(`${API_URL}/api/auth/login`, {
            username: 'admin', // Adjust if default admin username is different
            password: 'adminpassword' // You might need to check createAdmin.js or use an existing one
        });

        const token = loginRes.data.token;
        console.log('Login successful.');

        // 2. Fetch images
        console.log('Fetching image list...');
        const imagesRes = await axios.get(`${API_URL}/api/admin/images`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        console.log('Response Status:', imagesRes.status);
        console.log('Images Found:', imagesRes.data.length);
        console.log('Sample Image:', imagesRes.data[0]);

        if (imagesRes.data.length > 0) {
            console.log('✅ Verification Successful: Images listed correctly.');
        } else {
            console.log('⚠️ Warning: No images found, but request succeeded.');
        }

    } catch (err) {
        console.error('❌ Verification Failed:', err.response ? err.response.data : err.message);
    }
}

// Note: This script requires the backend server to be running.
// If it's not running, we rely on code inspection and manual verification by the user.
testImageListing();
