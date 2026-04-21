const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * STRICT AUTH MIDDLEWARE
 * Verifies JWT + checks if user's role in DB matches role in JWT.
 * This ensures that if a role is changed, the physical session is invalidated.
 */
const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authorization header missing or invalid' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // 🔒 STRICT CHECK: Fetch user from DB to verify role consistency
        const dbUser = await User.findById(decoded.id);
        
        if (!dbUser) {
            return res.status(401).json({ message: 'User no longer exists. Please login again.' });
        }

        // Check if role has changed since token issuance
        if (dbUser.role !== decoded.role) {
            return res.status(401).json({ 
                message: 'User role has been updated. For security, please login again.',
                relogin: true 
            });
        }

        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Invalid or expired token', expired: err.name === 'TokenExpiredError' });
    }
};

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
    }
    next();
};

const canManageBookings = (req, res, next) => {
    const roles = ['admin', 'engineer', 'organisation', 'employee'];
    if (!roles.includes(req.user.role)) {
        return res.status(403).json({ message: 'Access denied: Requires management permissions' });
    }
    next();
};

const isAdminOrEngineer = (req, res, next) => {
    const roles = ['admin', 'engineer', 'employee'];
    if (!roles.includes(req.user.role)) {
        return res.status(403).json({ message: 'Administrative access required' });
    }
    next();
};

module.exports = {
    verifyToken,
    isAdmin,
    canManageBookings,
    isAdminOrEngineer
};
