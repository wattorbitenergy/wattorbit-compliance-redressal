const express = require('express');
const router = express.Router();
const EMIConfig = require('../models/EMIConfig');
const Material = require('../models/Material');
const jwt = require('jsonwebtoken');

// Helper middleware for Admin verification
const verifyAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authorization required' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.role !== 'admin') {
            return res.status(403).json({ message: 'Admin access required' });
        }
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
};

// Default seed banks for Indian market if not initialized
const DEFAULT_BANKS = [
    {
        bankCode: 'HDFC',
        bankName: 'HDFC Bank',
        type: 'credit',
        isActive: true,
        gatewayBufferRate: 1.5,
        tenures: [
            { months: 3, annualRate: 14.0, minAmount: 3000, isNoCostAvailable: true },
            { months: 6, annualRate: 14.0, minAmount: 3000, isNoCostAvailable: true },
            { months: 9, annualRate: 15.0, minAmount: 5000, isNoCostAvailable: false },
            { months: 12, annualRate: 15.0, minAmount: 5000, isNoCostAvailable: false },
            { months: 18, annualRate: 15.5, minAmount: 10000, isNoCostAvailable: false },
            { months: 24, annualRate: 16.0, minAmount: 10000, isNoCostAvailable: false }
        ]
    },
    {
        bankCode: 'ICICI',
        bankName: 'ICICI Bank',
        type: 'credit',
        isActive: true,
        gatewayBufferRate: 1.5,
        tenures: [
            { months: 3, annualRate: 13.5, minAmount: 3000, isNoCostAvailable: true },
            { months: 6, annualRate: 13.5, minAmount: 3000, isNoCostAvailable: true },
            { months: 9, annualRate: 14.5, minAmount: 5000, isNoCostAvailable: false },
            { months: 12, annualRate: 14.5, minAmount: 5000, isNoCostAvailable: false },
            { months: 18, annualRate: 15.0, minAmount: 10000, isNoCostAvailable: false },
            { months: 24, annualRate: 15.5, minAmount: 10000, isNoCostAvailable: false }
        ]
    },
    {
        bankCode: 'SBI',
        bankName: 'State Bank of India',
        type: 'credit',
        isActive: true,
        gatewayBufferRate: 1.5,
        tenures: [
            { months: 3, annualRate: 14.5, minAmount: 3000, isNoCostAvailable: false },
            { months: 6, annualRate: 14.5, minAmount: 3000, isNoCostAvailable: false },
            { months: 9, annualRate: 15.0, minAmount: 5000, isNoCostAvailable: false },
            { months: 12, annualRate: 15.0, minAmount: 5000, isNoCostAvailable: false },
            { months: 18, annualRate: 15.5, minAmount: 10000, isNoCostAvailable: false },
            { months: 24, annualRate: 16.0, minAmount: 10000, isNoCostAvailable: false }
        ]
    },
    {
        bankCode: 'AXIS',
        bankName: 'Axis Bank',
        type: 'credit',
        isActive: true,
        gatewayBufferRate: 1.5,
        tenures: [
            { months: 3, annualRate: 14.0, minAmount: 3000, isNoCostAvailable: true },
            { months: 6, annualRate: 14.0, minAmount: 3000, isNoCostAvailable: true },
            { months: 9, annualRate: 14.5, minAmount: 5000, isNoCostAvailable: false },
            { months: 12, annualRate: 15.0, minAmount: 5000, isNoCostAvailable: false },
            { months: 18, annualRate: 15.5, minAmount: 10000, isNoCostAvailable: false }
        ]
    },
    {
        bankCode: 'KOTAK',
        bankName: 'Kotak Mahindra Bank',
        type: 'credit',
        isActive: true,
        gatewayBufferRate: 1.5,
        tenures: [
            { months: 3, annualRate: 14.0, minAmount: 3000, isNoCostAvailable: false },
            { months: 6, annualRate: 14.0, minAmount: 3000, isNoCostAvailable: false },
            { months: 9, annualRate: 15.0, minAmount: 5000, isNoCostAvailable: false },
            { months: 12, annualRate: 15.0, minAmount: 5000, isNoCostAvailable: false }
        ]
    },
    {
        bankCode: 'HDFC_DEBIT',
        bankName: 'HDFC Debit Card EMI',
        type: 'debit',
        isActive: true,
        gatewayBufferRate: 2.0,
        tenures: [
            { months: 3, annualRate: 15.0, minAmount: 5000, isNoCostAvailable: false },
            { months: 6, annualRate: 15.0, minAmount: 5000, isNoCostAvailable: false },
            { months: 12, annualRate: 16.0, minAmount: 10000, isNoCostAvailable: false }
        ]
    },
    {
        bankCode: 'CARDLESS_ZEST',
        bankName: 'Cardless / PayLater (Instant Approval)',
        type: 'cardless',
        isActive: true,
        gatewayBufferRate: 2.0,
        tenures: [
            { months: 3, annualRate: 16.0, minAmount: 3000, isNoCostAvailable: true },
            { months: 6, annualRate: 18.0, minAmount: 5000, isNoCostAvailable: false }
        ]
    }
];

// Ensure configuration exists
const getOrCreateConfig = async () => {
    let cfg = await EMIConfig.findOne({ key: 'emi_global_settings' });
    if (!cfg) {
        cfg = await EMIConfig.create({
            key: 'emi_global_settings',
            isEnabled: true,
            globalMinAmount: 3000,
            globalGatewayFeePercent: 2.0,
            banks: DEFAULT_BANKS
        });
    }
    return cfg;
};

// Standard reducing balance monthly EMI calculation formula:
// E = P * r * (1 + r)^n / ((1 + r)^n - 1)
const calculateMonthlyEMI = (principal, annualInterestRate, months) => {
    if (annualInterestRate === 0) {
        return Math.round(principal / months);
    }
    const monthlyRate = annualInterestRate / (12 * 100);
    const emi = (principal * monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
    return Math.round(emi);
};

/* =================================================================
   PUBLIC: GET ALL ACTIVE BANKS & PLANS (For Frontend Calculator)
   ================================================================= */
router.get('/plans', async (req, res) => {
    try {
        const config = await getOrCreateConfig();
        if (!config.isEnabled) {
            return res.json({ isEnabled: false, banks: [] });
        }
        res.json({
            isEnabled: true,
            globalMinAmount: config.globalMinAmount,
            globalGatewayFeePercent: config.globalGatewayFeePercent,
            banks: config.banks.filter(b => b.isActive)
        });
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch EMI plans', error: err.message });
    }
});

/* =================================================================
   PUBLIC: CALCULATE DYNAMIC EMI BREAKDOWN FOR A PRODUCT / CART AMOUNT
   ================================================================= */
router.post('/calculate', async (req, res) => {
    try {
        const { amount, productId } = req.body;
        const totalAmount = Number(amount);

        if (!totalAmount || isNaN(totalAmount) || totalAmount <= 0) {
            return res.status(400).json({ message: 'Valid amount is required' });
        }

        const config = await getOrCreateConfig();
        if (!config.isEnabled || totalAmount < config.globalMinAmount) {
            return res.json({
                isEligible: false,
                reason: `EMI is available on orders above ₹${config.globalMinAmount.toLocaleString()}`,
                plans: []
            });
        }

        // Check if product has specific no-cost override
        let productOverrides = null;
        if (productId) {
            try {
                const material = await Material.findById(productId).select('specifications make');
                // Could expand with specific subvention flags
            } catch (e) { /* ignore */ }
        }

        const plans = [];

        config.banks.filter(b => b.isActive).forEach(bank => {
            const buffer = bank.gatewayBufferRate || 0;

            const eligibleTenures = bank.tenures
                .filter(t => totalAmount >= (t.minAmount || config.globalMinAmount))
                .map(t => {
                    // Effective rate includes nominal bank rate + gateway fee buffer markup
                    const effectiveRate = Math.round((t.annualRate + buffer) * 10) / 10;
                    const monthlyEmi = calculateMonthlyEMI(totalAmount, effectiveRate, t.months);
                    const totalPayable = monthlyEmi * t.months;
                    const totalInterest = Math.max(0, totalPayable - totalAmount);

                    return {
                        months: t.months,
                        nominalRate: t.annualRate,
                        effectiveRate,
                        monthlyEmi,
                        totalPayable,
                        totalInterest,
                        isNoCostAvailable: t.isNoCostAvailable,
                        noCostMonthlyEmi: t.isNoCostAvailable ? Math.round(totalAmount / t.months) : null,
                        subventionSavings: t.isNoCostAvailable ? totalInterest : 0
                    };
                });

            if (eligibleTenures.length > 0) {
                // Find lowest monthly EMI for badge display
                const lowestEmi = Math.min(...eligibleTenures.map(t => t.monthlyEmi));

                plans.push({
                    bankCode: bank.bankCode,
                    bankName: bank.bankName,
                    type: bank.type,
                    gatewayBufferRate: buffer,
                    lowestEmi,
                    tenures: eligibleTenures
                });
            }
        });

        // Global lowest starting EMI across all banks
        const globalLowestEmi = plans.length > 0 ? Math.min(...plans.map(p => p.lowestEmi)) : 0;

        res.json({
            isEligible: plans.length > 0,
            amount: totalAmount,
            lowestMonthlyEmi: globalLowestEmi,
            plans
        });
    } catch (err) {
        res.status(500).json({ message: 'Calculation failed', error: err.message });
    }
});

/* =================================================================
   ADMIN: GET FULL CONFIGURATION (INCLUDING INACTIVE & RAW RATES)
   ================================================================= */
router.get('/admin/config', verifyAdmin, async (req, res) => {
    try {
        const config = await getOrCreateConfig();
        res.json(config);
    } catch (err) {
        res.status(500).json({ message: 'Error retrieving EMI admin settings', error: err.message });
    }
});

/* =================================================================
   ADMIN: UPDATE FULL CONFIGURATION / INDIVIDUAL BANK RATES
   ================================================================= */
router.put('/admin/config', verifyAdmin, async (req, res) => {
    try {
        const { isEnabled, globalMinAmount, globalGatewayFeePercent, banks } = req.body;
        let config = await getOrCreateConfig();

        if (typeof isEnabled === 'boolean') config.isEnabled = isEnabled;
        if (globalMinAmount !== undefined) config.globalMinAmount = Number(globalMinAmount);
        if (globalGatewayFeePercent !== undefined) config.globalGatewayFeePercent = Number(globalGatewayFeePercent);
        if (banks && Array.isArray(banks)) config.banks = banks;

        await config.save();
        res.json({ message: 'EMI Rates and Gateway Margins successfully updated!', config });
    } catch (err) {
        res.status(500).json({ message: 'Failed to update EMI settings', error: err.message });
    }
});

/* =================================================================
   ADMIN: QUICK UPDATE SINGLE BANK RATE
   ================================================================= */
router.patch('/admin/banks/:bankCode', verifyAdmin, async (req, res) => {
    try {
        const { bankCode } = req.params;
        const { isActive, gatewayBufferRate, tenures } = req.body;

        const config = await getOrCreateConfig();
        const bank = config.banks.find(b => b.bankCode === bankCode.toUpperCase());

        if (!bank) {
            return res.status(404).json({ message: `Bank with code ${bankCode} not found` });
        }

        if (typeof isActive === 'boolean') bank.isActive = isActive;
        if (gatewayBufferRate !== undefined) bank.gatewayBufferRate = Number(gatewayBufferRate);
        if (tenures && Array.isArray(tenures)) bank.tenures = tenures;

        await config.save();
        res.json({ message: `Bank ${bank.bankName} updated successfully`, bank });
    } catch (err) {
        res.status(500).json({ message: 'Failed to update bank rates', error: err.message });
    }
});

module.exports = router;
