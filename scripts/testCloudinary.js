require('dotenv').config();
const { uploadToCloudinary } = require('../utils/cloudinaryHelper');
const fs = require('fs');
const path = require('path');

async function testConnection() {
    console.log('--- Cloudinary Connection Test ---');
    
    // Check if env vars are loaded
    const url = process.env.CLOUDINARY_URL;
    const preset = process.env.CLOUDINARY_UPLOAD_PRESET;
    
    if (!url) {
        console.error('❌ Error: CLOUDINARY_URL is missing in .env');
        process.exit(1);
    }
    
    if (!preset) {
        console.warn('⚠️ Warning: CLOUDINARY_UPLOAD_PRESET is missing. Using default "ml_default".');
    }

    console.log('Using URL:', url.replace(/:[^:@]+@/, ':****@')); // Hide secret for logging
    console.log('Using Preset:', preset || 'ml_default');

    // Create a tiny 1x1 transparent PNG test image (valid image file)
    const testFilePath = path.join(__dirname, 'test_image.png');
    const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(testFilePath, pixel);

    try {
        console.log('Attempting test upload...');
        const result = await uploadToCloudinary(testFilePath, 'wattorbit/tests');
        
        console.log('✅ Image Upload Successful!');
        console.log('URL:', result.url);

        // Test RAW Upload (non-image)
        console.log('\nAttempting RAW test upload (text file)...');
        const rawFilePath = path.join(__dirname, 'test_log.txt');
        fs.writeFileSync(rawFilePath, 'Log content test for Cloudinary.');
        
        const rawResult = await uploadToCloudinary(rawFilePath, 'wattorbit/tests', 'raw');
        console.log('✅ RAW Upload Successful!');
        console.log('URL:', rawResult.url);
        
        if (fs.existsSync(rawFilePath)) fs.unlinkSync(rawFilePath);

    } catch (error) {
        console.error('❌ Connection Failed!');
        if (error.response) {
            console.error('Cloudinary Error Detail:', error.response.data);
        } else {
            console.error('Error:', error.message);
        }
    } finally {
        // Cleanup
        if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
    }
}

testConnection();
