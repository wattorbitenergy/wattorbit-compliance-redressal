const mongoose = require('mongoose');

const materialSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    make: {
        type: String,
        required: true,
        trim: true,
        comment: "Brand/Manufacturer"
    },
    description: {
        type: String,
        required: true,
        trim: true,
        comment: "Detailed features to prove genuineness/authenticity"
    },
    hsnCode: {
        type: String,
        trim: true
    },
    unit: {
        type: String,
        default: 'pcs',
        trim: true
    },

    // Stock Management
    stockQuantity: {
        type: Number,
        default: 0,
        min: 0,
        comment: "Available units in inventory"
    },
    reorderLevel: {
        type: Number,
        default: 5,
        min: 0,
        comment: "Threshold below which low-stock alert triggers"
    },

    // Genuineness / Warranty
    warrantyMonths: {
        type: Number,
        default: 0,
        min: 0,
        comment: "Warranty period in months"
    },
    materialCode: {
        type: String,
        unique: true,
        sparse: true,
        comment: "Auto-incrementing code starting from 10001"
    },
    manufacturerCode: {
        type: String,
        trim: true,
        default: '',
        comment: "OEM part number or manufacturer code"
    },
    unit: {
        type: String,
        trim: true,
        default: 'Nos.',
        comment: "Unit of measurement: Nos., Mtr, Lot"
    },

    // Photos
    images: {
        type: [String],
        default: [],
        comment: "Product/packaging photo URLs"
    },
    
    // Financials - Purchase
    purchasePrice: {
        type: Number,
        required: true,
        min: 0,
        comment: "Net cost price (before tax)"
    },
    purchaseTaxRate: {
        type: Number,
        required: true,
        enum: [0, 5, 12, 18, 28],
        comment: "Input GST percentage"
    },
    purchaseTaxAmount: {
        type: Number,
        default: 0
    },

    // Financials - Selling
    mrp: {
        type: Number,
        required: true,
        min: 0,
        comment: "Maximum Retail Price (Inclusive of all taxes)"
    },
    sellingPrice: {
        type: Number,
        required: true,
        min: 0,
        comment: "Net selling price (before tax)"
    },
    sellingTaxRate: {
        type: Number,
        required: true,
        enum: [0, 5, 12, 18, 28],
        comment: "Output GST percentage"
    },
    sellingTaxAmount: {
        type: Number,
        default: 0
    },

    // Calculated Liability
    taxLiability: {
        type: Number,
        default: 0,
        comment: "Output Tax - Input Tax"
    },

    isActive: {
        type: Boolean,
        default: true
    },
    deactivationRemark: {
        type: String,
        trim: true,
        default: ''
    },
    deactivatedAt: {
        type: Date
    },

    // Reviews & Ratings
    reviews: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        name: {
            type: String,
            required: true
        },
        rating: {
            type: Number,
            required: true,
            min: 1,
            max: 5
        },
        comment: {
            type: String,
            trim: true
        },
        createdAt: {
            type: Date,
            default: Date.now
        }
    }],
    averageRating: {
        type: Number,
        default: 0
    },
    numReviews: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

const { round } = require('../utils/mathUtils');

// Virtual: Discount Percentage
materialSchema.virtual('discountPercentage').get(function () {
    const totalSellingPrice = this.sellingPrice + this.sellingTaxAmount;
    if (!this.mrp || totalSellingPrice >= this.mrp) return 0;
    return Math.round(((this.mrp - totalSellingPrice) / this.mrp) * 100);
});

// ... (schema definition remains same)

// Pre-save hook to calculate tax amounts and liability
materialSchema.pre('save', async function () {
    // ... (material code generation remains same)
    if (this.isNew || !this.materialCode) {
        try {
            const lastMaterial = await this.constructor.findOne(
                { materialCode: { $exists: true } },
                { materialCode: 1 },
                { sort: { materialCode: -1 } }
            );
            
            let nextCode = 10001;
            if (lastMaterial && lastMaterial.materialCode) {
                const lastNum = parseInt(lastMaterial.materialCode);
                if (!isNaN(lastNum)) {
                    nextCode = lastNum + 1;
                }
            }
            this.materialCode = nextCode.toString();
        } catch (err) {
            console.error('[MaterialCode] Error generating code:', err);
        }
    }

    this.purchaseTaxAmount = round((this.purchasePrice * this.purchaseTaxRate) / 100);
    this.sellingTaxAmount = round((this.sellingPrice * this.sellingTaxRate) / 100);
    this.taxLiability = round(this.sellingTaxAmount - this.purchaseTaxAmount);
});

// Virtual: check if stock is low
materialSchema.virtual('isLowStock').get(function () {
    return this.stockQuantity <= this.reorderLevel;
});

// Ensure virtuals are included in JSON output
materialSchema.set('toJSON', { virtuals: true });
materialSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Material', materialSchema);
