const axios = require('axios');
const formData = require('form-data');
const fs = require('fs');

// Parse CLOUDINARY_URL (cloudinary://api_key:api_secret@cloud_name) if provided
let CLOUD_NAME, API_KEY, API_SECRET;
if (process.env.CLOUDINARY_URL) {
    const parsed = new URL(process.env.CLOUDINARY_URL.replace('cloudinary://', 'https://'));
    API_KEY = parsed.username;
    API_SECRET = parsed.password;
    CLOUD_NAME = parsed.hostname;
} else {
    CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
    API_KEY = process.env.CLOUDINARY_API_KEY;
    API_SECRET = process.env.CLOUDINARY_API_SECRET;
}
const UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || 'ml_default';

const crypto = require('crypto');

/**
 * Upload a file to Cloudinary (Signed Upload)
 * @param {string} filePath - Path to local file
 * @param {string} folder - Cloudinary folder (e.g. 'bookings/photos')
 * @param {string} resourceType - 'image', 'video', 'raw', or 'auto'
 */
const uploadToCloudinary = async (filePath, folder = 'wattorbit/jobs', resourceType = 'image') => {
    try {
        if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
            throw new Error('Cloudinary credentials (URL) missing or incomplete');
        }
        
        const timestamp = Math.round(new Date().getTime() / 1000);
        const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`;
        
        // 1. Prepare parameters for signing
        const paramsToSign = {
            folder: folder,
            timestamp: timestamp,
            upload_preset: UPLOAD_PRESET
        };

        // 2. Create the signature string
        const signatureString = Object.keys(paramsToSign)
            .sort()
            .map(key => `${key}=${paramsToSign[key]}`)
            .join('&') + API_SECRET;

        // 3. Hash the string using SHA1
        const signature = crypto.createHash('sha1').update(signatureString).digest('hex');

        // 4. Prepare Form Data
        const body = new formData();
        body.append('file', fs.createReadStream(filePath));
        body.append('api_key', API_KEY);
        body.append('timestamp', timestamp);
        body.append('signature', signature);
        body.append('folder', folder);
        body.append('upload_preset', UPLOAD_PRESET);

        const response = await axios.post(url, body, {
            headers: body.getHeaders()
        });

        return { url: response.data.secure_url, publicId: response.data.public_id };
    } catch (err) {
        console.error(`[Cloudinary] ${resourceType.toUpperCase()} Upload Error:`, err.response?.data || err.message);
        throw err;
    }
};

module.exports = { uploadToCloudinary };
