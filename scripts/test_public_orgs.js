const axios = require('axios');

const BASE_URL = 'http://localhost:5000/api/auth';

async function testPublicOrgs() {
    try {
        console.log('Testing GET /public-organisations...');
        const response = await axios.get(`${BASE_URL}/public-organisations`);

        console.log('Status:', response.status);
        console.log('Data Type:', typeof response.data);
        console.log('Is Array:', Array.isArray(response.data));

        if (Array.isArray(response.data)) {
            console.log('Count:', response.data.length);
            if (response.data.length > 0) {
                console.log('First Org Sample:', response.data[0]);

                // Validate structure
                const org = response.data[0];
                if (org.name && org._id) {
                    console.log('✅ Structure validated: name and _id present.');
                } else {
                    console.log('❌ Structure invalid: name or _id missing.');
                }
            } else {
                console.log('ℹ️ No organisations found in database.');
            }
        }

        console.log('✅ Test completed successfully.');
    } catch (err) {
        console.error('❌ Test failed.');
        if (err.response) {
            console.error('Response Status:', err.response.status);
            console.error('Response Data:', err.response.data);
        } else {
            console.error('Error Message:', err.message);
        }
    }
}

testPublicOrgs();
