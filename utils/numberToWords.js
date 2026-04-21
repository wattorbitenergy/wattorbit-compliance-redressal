/**
 * Converts a number into words in Indian numbering system
 * @param {number} amount - The numeric amount to convert
 * @returns {string} - The amount in words (Rupees...)
 */
const convertNumberToWords = (amount) => {
    const fraction = Math.round((amount % 1) * 100);
    let fullAmount = Math.floor(amount);

    const units = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    const convertGroup = (num) => {
        let str = '';
        if (num >= 100) {
            str += units[Math.floor(num / 100)] + ' Hundred ';
            num %= 100;
        }
        if (num >= 20) {
            str += tens[Math.floor(num / 10)] + ' ';
            num %= 10;
        }
        if (num > 0) {
            str += units[num] + ' ';
        }
        return str.trim();
    };

    if (fullAmount === 0 && fraction === 0) return 'Zero Rupees Only';

    let result = '';

    if (fullAmount >= 10000000) {
        result += convertGroup(Math.floor(fullAmount / 10000000)) + ' Crore ';
        fullAmount %= 10000000;
    }
    if (fullAmount >= 100000) {
        result += convertGroup(Math.floor(fullAmount / 100000)) + ' Lakh ';
        fullAmount %= 100000;
    }
    if (fullAmount >= 1000) {
        result += convertGroup(Math.floor(fullAmount / 1000)) + ' Thousand ';
        fullAmount %= 1000;
    }
    if (fullAmount > 0) {
        result += convertGroup(fullAmount);
    }

    result = result.trim() + ' Rupees';

    if (fraction > 0) {
        result += ' and ' + convertGroup(fraction) + ' Paise';
    }

    return result + ' Only';
};

module.exports = { convertNumberToWords };
