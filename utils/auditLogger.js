const AdminLog = require('../models/AdminLog');

/**
 * Middleware to log admin actions for state-modifying requests.
 */
const auditLogger = async (req, res, next) => {
    // We only care about state-modifying requests (POST, PUT, PATCH, DELETE)
    // and only if the user is an admin.
    const { method, originalUrl: endpoint, user } = req;
    
    // Store original send for interception or just log on success
    const originalSend = res.send;

    res.send = function(data) {
        // We only log if the status code is successful (2xx) and the user is an admin
        if (user && user.role === 'admin' && res.statusCode >= 200 && res.statusCode < 300) {
            const logEntry = new AdminLog({
                adminId: user.id || user._id,
                action: `${method}_${endpoint.split('/')[2]?.toUpperCase() || 'ACTION'}`,
                method,
                endpoint,
                details: {
                    body: req.body,
                    params: req.params,
                    query: req.query
                },
                ipAddress: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress,
                userAgent: req.headers['user-agent']
            });

            // Don't log passwords or sensitive tokens if they happen to be in the body
            if (logEntry.details.body) {
                const sensitiveFields = ['password', 'token', 'otp', 'newPassword'];
                sensitiveFields.forEach(field => {
                    if (logEntry.details.body[field]) {
                        logEntry.details.body[field] = '*****';
                    }
                });
            }

            logEntry.save().catch(err => {
                console.error('Audit Log Error:', err);
            });
        }
        
        return originalSend.apply(res, arguments);
    };

    next();
};

module.exports = auditLogger;
