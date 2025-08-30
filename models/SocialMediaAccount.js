const mongoose = require('mongoose');

const socialMediaAccountSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  platform: {
    type: String,
    required: true,
    enum: ['twitter', 'facebook', 'instagram', 'linkedin']
  },
  accountName: {
    type: String,
    required: true,
    trim: true
  },
  accountId: {
    type: String,
    required: true
  },
  accessToken: {
    type: String,
    required: true
  },
  refreshToken: {
    type: String
  },
  tokenExpiresAt: {
    type: Date
  },
  // Platform-specific fields
  pageId: {
    type: String // For Facebook pages
  },
  pageName: {
    type: String // For Facebook pages
  },
  instagramAccountId: {
    type: String // For Instagram Business accounts
  },
  linkedinUserId: {
    type: String // For LinkedIn user ID
  },
  // Account status
  isActive: {
    type: Boolean,
    default: true
  },
  lastUsed: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Compound index to ensure unique platform per user
socialMediaAccountSchema.index({ userId: 1, platform: 1, accountId: 1 }, { unique: true });

// Remove sensitive data from JSON output
socialMediaAccountSchema.methods.toJSON = function() {
  const account = this.toObject();
  delete account.accessToken;
  delete account.refreshToken;
  return account;
};

// Method to check if token is expired
socialMediaAccountSchema.methods.isTokenExpired = function() {
  if (!this.tokenExpiresAt) return false;
  return new Date() > this.tokenExpiredAt;
};

// Method to update last used timestamp
socialMediaAccountSchema.methods.updateLastUsed = function() {
  this.lastUsed = new Date();
  return this.save();
};

module.exports = mongoose.model('SocialMediaAccount', socialMediaAccountSchema);
