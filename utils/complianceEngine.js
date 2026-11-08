/**
 * Statutory GST Compliance & Pre-Flight Double Check Engine
 * Validates mathematical accuracy, place of supply rules, HSN completeness,
 * and calculates automated ITC set-off & 1% TCS under Section 52.
 */

const { round } = require('./mathUtils');

// Standard Indian State Codes for GST
const STATE_GST_CODES = {
    'JAMMU AND KASHMIR': '01', 'HIMACHAL PRADESH': '02', 'PUNJAB': '03', 'CHANDIGARH': '04',
    'UTTARAKHAND': '05', 'HARYANA': '06', 'DELHI': '07', 'RAJASTHAN': '08',
    'UTTAR PRADESH': '09', 'BIHAR': '10', 'SIKKIM': '11', 'ARUNACHAL PRADESH': '12',
    'NAGALAND': '13', 'MANIPUR': '14', 'MIZORAM': '15', 'TRIPURA': '16',
    'MEGHALAYA': '17', 'ASSAM': '18', 'WEST BENGAL': '19', 'JHARKHAND': '20',
    'ODISHA': '21', 'CHHATTISGARH': '22', 'MADHYA PRADESH': '23', 'GUJARAT': '24',
    'MAHARASHTRA': '27', 'ANDHRA PRADESH': '28', 'KARNATAKA': '29', 'GOA': '30',
    'KERALA': '32', 'TAMIL NADU': '33', 'TELANGANA': '36'
};

/**
 * Perform Pre-Flight Verification on an Invoice before creation or save
 * @param {Object} invoiceData - Invoice payload
 * @param {Object} options - Options including sellerProfile, isMarketplace, etc.
 * @returns {Object} Verified and enriched invoice data with audit notes
 */
function verifyAndEnrichInvoiceCompliance(invoiceData, options = {}) {
    const auditNotes = [];
    let isMathValid = true;
    let hasValidHsn = true;
    let hasValidGSTIN = true;

    // 1. Double check Line Items & Mathematical Totals
    let calculatedTaxable = 0;
    let calculatedCGST = 0;
    let calculatedSGST = 0;
    let calculatedIGST = 0;

    const items = invoiceData.items || [];
    items.forEach((item, idx) => {
        const itemTaxable = round(Number(item.taxableValue || (item.unitPrice * (item.quantity || 1))));
        calculatedTaxable += itemTaxable;

        const rate = Number(item.taxRate || 0);
        const itemCGST = round(Number(item.cgstAmount || 0));
        const itemSGST = round(Number(item.sgstAmount || 0));
        const itemIGST = round(Number(item.igstAmount || 0));

        calculatedCGST += itemCGST;
        calculatedSGST += itemSGST;
        calculatedIGST += itemIGST;

        // Check HSN code
        if (!item.hsnSac || item.hsnSac.trim() === '') {
            hasValidHsn = false;
            auditNotes.push(`Item #${idx + 1} (${item.description || 'Unknown'}) is missing statutory HSN/SAC code.`);
        }
    });

    calculatedTaxable = round(calculatedTaxable);
    const calculatedTotalTax = round(calculatedCGST + calculatedSGST + calculatedIGST);
    const calculatedGrandTotal = round(calculatedTaxable + calculatedTotalTax - Number(invoiceData.discount || 0));

    // Verify against claimed totals
    const declaredTotal = round(Number(invoiceData.totalAmount || 0));
    if (Math.abs(calculatedGrandTotal - declaredTotal) > 1.0) {
        isMathValid = false;
        auditNotes.push(`Math mismatch: Declared total ₹${declaredTotal} differs from calculated total ₹${calculatedGrandTotal}.`);
    }

    // 2. GSTIN Check
    const supplierGST = (invoiceData.businessGST || '').trim().toUpperCase();
    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    if (!gstinRegex.test(supplierGST)) {
        hasValidGSTIN = false;
        auditNotes.push(`Supplier GSTIN (${supplierGST || 'None'}) does not match the 15-digit statutory alphanumeric structure.`);
    }

    // 3. Determine Intra-State vs Inter-State consistency
    const supplierStateCode = supplierGST.slice(0, 2);
    const posState = (invoiceData.placeOfSupply || '').trim().toUpperCase();
    const buyerStateCode = STATE_GST_CODES[posState] || (invoiceData.stateCode || '').trim();

    const isIntraState = supplierStateCode && buyerStateCode ? (supplierStateCode === buyerStateCode) : (calculatedIGST === 0);

    if (isIntraState && calculatedIGST > 0) {
        auditNotes.push(`Inconsistency: Supply is Intra-State (${supplierStateCode}), but IGST (₹${calculatedIGST}) was levied.`);
    } else if (!isIntraState && (calculatedCGST > 0 || calculatedSGST > 0)) {
        auditNotes.push(`Inconsistency: Supply is Inter-State (${supplierStateCode} -> ${buyerStateCode}), but CGST/SGST was levied.`);
    }

    // 4. Calculate Automated 1% TCS under Section 52 for Marketplace Seller Invoices
    let tcsAmount = 0;
    let tcsRate = 0;
    if (invoiceData.invoiceType === 'marketplace_seller') {
        tcsRate = 1; // 1% net taxable supply
        tcsAmount = round((calculatedTaxable * 1) / 100);
        auditNotes.push(`Section 52 Compliance: 1% E-Commerce TCS of ₹${tcsAmount} calculated for GSTR-8.`);
    }

    // 5. Automated Set-Off: Output Tax vs Eligible ITC
    const itcAmount = round(Number(invoiceData.itcAmount || 0));
    const netTaxPayable = round(Math.max(0, calculatedTotalTax - itcAmount - tcsAmount));

    return {
        ...invoiceData,
        subtotal: calculatedTaxable,
        totalCGST: calculatedCGST,
        totalSGST: calculatedSGST,
        totalIGST: calculatedIGST,
        taxAmount: calculatedTotalTax,
        totalAmount: calculatedGrandTotal,
        itcAmount,
        netTaxPayable,
        tcsRate,
        tcsAmount,
        complianceAudit: {
            isMathValid,
            isIntraState,
            hasValidHsn,
            hasValidGSTIN,
            verifiedAt: new Date(),
            discrepancyNotes: auditNotes
        }
    };
}

module.exports = {
    STATE_GST_CODES,
    verifyAndEnrichInvoiceCompliance
};
