const mongoose = require('mongoose');

const materialReviewSchema = new mongoose.Schema({
    materialId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Material',
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    userName: {
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
        required: true,
        trim: true
    },
    images: {
        type: [String],
        default: []
    },
    isVerifiedPurchase: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

// Ensure one review per user per material
materialReviewSchema.index({ materialId: 1, userId: 1 }, { unique: true });

// Static method to calculate average rating
materialReviewSchema.statics.getAverageRating = async function(materialId) {
    const obj = await this.aggregate([
        {
            $match: { materialId: materialId }
        },
        {
            $group: {
                _id: '$materialId',
                averageRating: { $avg: '$rating' },
                numReviews: { $sum: 1 }
            }
        }
    ]);

    try {
        await mongoose.model('Material').findByIdAndUpdate(materialId, {
            averageRating: obj[0] ? Math.round(obj[0].averageRating * 10) / 10 : 0,
            numReviews: obj[0] ? obj[0].numReviews : 0
        });
    } catch (err) {
        console.error(err);
    }
};

// Call getAverageRating after save
materialReviewSchema.post('save', function() {
    this.constructor.getAverageRating(this.materialId);
});

// Call getAverageRating after remove
materialReviewSchema.post('remove', function() {
    this.constructor.getAverageRating(this.materialId);
});

module.exports = mongoose.model('MaterialReview', materialReviewSchema);
