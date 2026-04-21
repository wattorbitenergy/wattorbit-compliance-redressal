/**
 * Simple JSON to CSV Converter
 * @param {Array<Object>} data - Array of objects to convert
 * @param {Array<string>} headers - Specific headers to include (optional)
 * @returns {string} - CSV string
 */
const jsonToCsv = (data, headers = null) => {
    if (!data || data.length === 0) return '';
    
    // Determine headers if not provided
    const cols = headers || Object.keys(data[0]);
    
    const headerRow = cols.map(c => `"${c.toUpperCase()}"`).join(',');
    
    const rows = data.map(item => {
        return cols.map(col => {
            let val = item[col];
            if (val === null || val === undefined) val = '';
            // Escape double quotes and wrap in quotes
            const stringVal = String(val).replace(/"/g, '""');
            return `"${stringVal}"`;
        }).join(',');
    });
    
    return [headerRow, ...rows].join('\n');
};

module.exports = { jsonToCsv };
