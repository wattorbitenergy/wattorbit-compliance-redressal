const axios = require('axios');
const formData = require('form-data');
const fs = require('fs');

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || 'ml_default';
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

/**
 * Upload an image to Cloudinary
 * @param {string} filePath - Path to local file
 * @param {string} folder - Cloudinary folder (e.g. 'bookings/photos')
 */
const uploadToCloudinary = async (filePath, folder = 'wattorbit/jobs') => {
    try {
        if (!CLOUD_NAME) throw new Error('Cloudinary Cloud Name missing');
        
        const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
        
        // Prepare Form Data
        const body = new formData();
        body.append('file', fs.createReadStream(filePath));
        body.append('upload_preset', UPLOAD_PRESET);
        body.append('folder', folder);

        const response = await axios.post(url, body, {
            headers: body.getHeaders()
        });

        return { url: response.data.secure_url, publicId: response.data.public_id };
    } catch (err) {
        console.error('[Cloudinary] Upload Error:', err.response?.data || err.message);
        throw err;
    }
};

module.exports = { uploadToCloudinary };
