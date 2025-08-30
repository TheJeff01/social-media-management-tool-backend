const express = require("express");
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const SocialMediaAccount = require('../models/SocialMediaAccount');
const router = express.Router();

// Health check for auth routes
router.get("/status", (req, res) => {
  res.json({
    status: "Auth service is running",
    timestamp: new Date().toISOString(),
    availableProviders: ["twitter", "linkedin", "facebook", "instagram"],
  });
});

// User Registration
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, firstName, lastName } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ 
      $or: [{ email }, { username }] 
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: existingUser.email === email ? 'Email already registered' : 'Username already taken'
      });
    }

    // Create new user
    const user = new User({
      username,
      email,
      password,
      firstName,
      lastName
    });

    await user.save();

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, username: user.username },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: user.toJSON(),
      token
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message
    });
  }
});

// User Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, username: user.username },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      user: user.toJSON(),
      token
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
});

// Get user profile
router.get('/profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user: user.toJSON()
    });

  } catch (error) {
    console.error('Profile error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid token',
      error: error.message
    });
  }
});

// Logout endpoint
router.post('/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    // In a production environment, you might want to:
    // 1. Add the token to a blacklist
    // 2. Update the user's last logout time
    // 3. Log the logout event
    
    // For now, we'll just return success
    // The frontend will handle clearing the token from localStorage
    
    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed',
      error: error.message
    });
  }
});

// Save social media account
router.post('/social-accounts', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const { platform, accountName, accountId, accessToken, refreshToken, tokenExpiresAt, pageId, pageName, instagramAccountId, linkedinUserId } = req.body;

    // Check if account already exists for this user and platform
    const existingAccount = await SocialMediaAccount.findOne({
      userId: decoded.userId,
      platform,
      accountId
    });

    if (existingAccount) {
      // Update existing account
      existingAccount.accountName = accountName;
      existingAccount.accessToken = accessToken;
      existingAccount.refreshToken = refreshToken;
      existingAccount.tokenExpiresAt = tokenExpiresAt;
      existingAccount.pageId = pageId;
      existingAccount.pageName = pageName;
      existingAccount.instagramAccountId = instagramAccountId;
      existingAccount.linkedinUserId = linkedinUserId;
      existingAccount.lastUsed = new Date();
      
      await existingAccount.save();

      res.json({
        success: true,
        message: 'Social media account updated successfully',
        account: existingAccount.toJSON()
      });
    } else {
      // Create new account
      const socialAccount = new SocialMediaAccount({
        userId: decoded.userId,
        platform,
        accountName,
        accountId,
        accessToken,
        refreshToken,
        tokenExpiresAt,
        pageId,
        pageName,
        instagramAccountId,
        linkedinUserId
      });

      await socialAccount.save();

      res.status(201).json({
        success: true,
        message: 'Social media account saved successfully',
        account: socialAccount.toJSON()
      });
    }

  } catch (error) {
    console.error('Save social account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save social media account',
      error: error.message
    });
  }
});

// Get user's social media accounts
router.get('/social-accounts', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const accounts = await SocialMediaAccount.find({ 
      userId: decoded.userId,
      isActive: true 
    }).sort({ lastUsed: -1 });

    res.json({
      success: true,
      accounts: accounts.map(account => account.toJSON())
    });

  } catch (error) {
    console.error('Get social accounts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get social media accounts',
      error: error.message
    });
  }
});

// Delete social media account
router.delete('/social-accounts/:accountId', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const { accountId } = req.params;

    const account = await SocialMediaAccount.findOneAndDelete({
      _id: accountId,
      userId: decoded.userId
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    res.json({
      success: true,
      message: 'Social media account deleted successfully'
    });

  } catch (error) {
    console.error('Delete social account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete social media account',
      error: error.message
    });
  }
});

module.exports = router;
