const { checkServiceability, CITY_PREFIX_MAP } = require('../services/pincodeService');

async function testEngine() {
    console.log('--- Testing Automated City-Wise Pincode Coverage Engine ---');

    const testPins = [
        { pin: '226202', label: 'Lucknow (From production log)' },
        { pin: '224152', label: 'Ayodhya / Ambedkar Nagar (From production log)' },
        { pin: '110001', label: 'Connaught Place, Delhi' },
        { pin: '261001', label: 'Sitapur, UP' },
        { pin: '208001', label: 'Kanpur, UP' },
        { pin: '999999', label: 'Non-existent / Unregistered PIN' }
    ];

    for (const item of testPins) {
        try {
            const res = await checkServiceability(item.pin);
            console.log(`\nPIN ${item.pin} (${item.label}):`);
            console.log(`  Available: ${res.available}`);
            console.log(`  City: ${res.city || 'N/A'}`);
            console.log(`  Message: ${res.message}`);
        } catch (err) {
            console.error(`  Error for PIN ${item.pin}:`, err.message);
        }
    }

    console.log('\n--- Test Completed Successfully ---');
    process.exit(0);
}

testEngine();
