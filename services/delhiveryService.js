const axios = require('axios');

const DELHIVERY_API_URL = process.env.DELHIVERY_API_URL || 'https://track.delhivery.com';
const DELHIVERY_API_TOKEN = process.env.DELHIVERY_API_TOKEN || '';

/**
 * Creates a shipment on Delhivery
 */
async function createShipment({ orderId, pickupDetails, deliveryDetails, packageDetails }) {
    if (!DELHIVERY_API_TOKEN) {
        throw new Error('Delhivery API token is not configured.');
    }

    const payload = {
        pickup_location: {
            name: pickupDetails.name || 'Warehouse',
            add: pickupDetails.address || '',
            city: pickupDetails.city || '',
            pin_code: pickupDetails.pincode || '',
            country: 'India',
            phone: pickupDetails.phone || ''
        },
        shipments: [
            {
                name: deliveryDetails.name || 'Customer',
                add: deliveryDetails.address || '',
                pin: deliveryDetails.pincode || '',
                city: deliveryDetails.city || '',
                state: deliveryDetails.state || '',
                country: 'India',
                phone: deliveryDetails.phone || '',
                order: orderId,
                payment_mode: packageDetails.payment_mode || 'Prepaid',
                cod_amount: packageDetails.cod_amount || 0,
                weight: packageDetails.weight || 500, // default 500g
                quantity: packageDetails.quantity || 1,
                products_desc: packageDetails.name || 'Material Order'
            }
        ]
    };

    try {
        const formData = new URLSearchParams();
        formData.append('format', 'json');
        formData.append('data', JSON.stringify(payload));

        const response = await axios.post(`${DELHIVERY_API_URL}/api/cmu/create.json`, formData, {
            headers: {
                'Authorization': `Token ${DELHIVERY_API_TOKEN}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        const data = response.data;
        if (data && data.success && data.packages && data.packages.length > 0) {
            const pkg = data.packages[0];
            return {
                success: true,
                awb: pkg.waybill,
                shipment_id: pkg.ref_num, // Delhivery uses ref_num or waybill
                message: data.rmk
            };
        } else {
            return {
                success: false,
                message: data.rmk || 'Failed to create shipment on Delhivery'
            };
        }
    } catch (error) {
        console.error('[Delhivery] Create Shipment Error:', error.response?.data || error.message);
        throw new Error('Delhivery API error: ' + (error.response?.data?.error || error.message));
    }
}

/**
 * Tracks a shipment by AWB number
 */
async function trackShipment(awbNumber) {
    if (!DELHIVERY_API_TOKEN) {
        throw new Error('Delhivery API token is not configured.');
    }

    try {
        const response = await axios.get(`${DELHIVERY_API_URL}/api/v1/packages/json/?waybill=${awbNumber}&token=${DELHIVERY_API_TOKEN}`);
        return response.data;
    } catch (error) {
        console.error('[Delhivery] Track Shipment Error:', error.response?.data || error.message);
        throw new Error('Delhivery API error: ' + (error.response?.data?.error || error.message));
    }
}

/**
 * Cancels a shipment by AWB number
 */
async function cancelShipment(awbNumber) {
    if (!DELHIVERY_API_TOKEN) {
        throw new Error('Delhivery API token is not configured.');
    }

    try {
        const response = await axios.post(`${DELHIVERY_API_URL}/api/p/edit`, {
            waybill: awbNumber,
            cancellation: true
        }, {
            headers: {
                'Authorization': `Token ${DELHIVERY_API_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error) {
        console.error('[Delhivery] Cancel Shipment Error:', error.response?.data || error.message);
        throw new Error('Delhivery API error: ' + (error.response?.data?.error || error.message));
    }
}

module.exports = {
    createShipment,
    trackShipment,
    cancelShipment
};
