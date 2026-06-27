const mongoose = require('mongoose');

const blogSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  content: {
    type: String,
    required: true,
  },
  excerpt: {
    type: String,
    trim: true,
  },
  author: {
    type: String,
    default: 'WattOrbit Team'
  },
  tags: [{
    type: String,
    trim: true
  }],
  seoTitle: {
    type: String,
    trim: true
  },
  seoDescription: {
    type: String,
    trim: true
  },
  coverImage: {
    type: String,
  },
  isPublished: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

// Auto-generate slug from title if not provided or empty
blogSchema.pre('validate', function(next) {
  if (this.title && !this.slug) {
    this.slug = this.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }
  if (!this.seoTitle) {
    this.seoTitle = this.title;
  }
  if (!this.seoDescription && this.excerpt) {
    this.seoDescription = this.excerpt;
  }
  next();
});

module.exports = mongoose.model('Blog', blogSchema);
