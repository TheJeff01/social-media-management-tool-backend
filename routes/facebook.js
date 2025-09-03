const express = require("express");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();
const jwt = require('jsonwebtoken');
const SocialMediaAccount = require('../models/SocialMediaAccount');

const oauthConfig = require("../config/oauth");
const pkceUtils = require("../utils/pkce");
const tokenUtils = require("../utils/tokens");

// Authentication middleware
const authenticateUser = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Step 1: Initiate Facebook OAuth
router.get("/", (req, res) => {
  try {
    const state = pkceUtils.generateState();

    const authUrl = new URL(oauthConfig.facebook.authUrl);
    authUrl.searchParams.append("client_id", oauthConfig.facebook.clientId);
    authUrl.searchParams.append(
      "redirect_uri",
      oauthConfig.facebook.redirectUri
    );
    authUrl.searchParams.append("scope", oauthConfig.facebook.scope);
    authUrl.searchParams.append("response_type", "code");
    authUrl.searchParams.append("state", state);

    console.log("📘 Redirecting to Facebook OAuth:", authUrl.toString());
    res.redirect(authUrl.toString());
  } catch (error) {
    console.error("Facebook OAuth initiation error:", error);
    res.redirect(`/facebook-callback.html?error=auth_initiation_failed`);
  }
});

// Step 2: Handle Facebook OAuth callback
router.get("/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error("Facebook OAuth error:", error);
    return res.redirect(`/facebook-callback.html?error=${error}`);
  }

  if (!code) {
    return res.redirect(`/facebook-callback.html?error=missing_code`);
  }

  try {
    // Exchange code for access token
    const tokenResponse = await axios.get(oauthConfig.facebook.tokenUrl, {
      params: {
        client_id: oauthConfig.facebook.clientId,
        client_secret: oauthConfig.facebook.clientSecret,
        redirect_uri: oauthConfig.facebook.redirectUri,
        code: code,
      },
    });

    const { access_token } = tokenResponse.data;

    // Get user profile
    const userResponse = await axios.get(oauthConfig.facebook.userUrl, {
      params: {
        access_token: access_token,
        fields: "id,name,email,picture.type(large)",
      },
    });

    const user = userResponse.data;

    // Get user's pages (for posting)
    const pagesResponse = await axios.get(
      `https://graph.facebook.com/v18.0/me/accounts`,
      {
        params: {
          access_token: access_token,
          fields: "id,name,access_token,picture",
        },
      }
    );

    const pages = pagesResponse.data.data || [];

    // Create session with user and pages data
    const sessionId = uuidv4();
    tokenUtils.storeTokens(sessionId, {
      platform: "facebook",
      accessToken: access_token,
      user: user,
      pages: pages,
    });

    // Redirect to callback page with session ID for popup communication
    res.redirect(`/facebook-callback.html?success=true&session=${sessionId}`);
  } catch (error) {
    console.error(
      "Facebook token exchange error:",
      error.response?.data || error.message
    );
    res.redirect(`/facebook-callback.html?error=token_exchange_failed`);
  }
});

// Get available pages from session
router.get("/pages/:sessionId", authenticateUser, async (req, res) => {
  const { sessionId } = req.params;
  const tokens = tokenUtils.getTokens(sessionId);

  if (!tokens || tokens.platform !== "facebook") {
    return res.status(404).json({ error: "Session not found" });
  }

  try {
    res.json({
      pages: tokens.pages,
      user: tokens.user
    });
  } catch (error) {
    console.error('Error fetching pages:', error);
    res.status(500).json({ error: 'Failed to fetch pages' });
  }
});

// Fixed Facebook backend route - Step 3: Save selected Facebook page to database
router.post("/user/:sessionId", authenticateUser, async (req, res) => {
  const { sessionId } = req.params;
  const tokens = tokenUtils.getTokens(sessionId);

  if (!tokens || tokens.platform !== "facebook") {
    return res.status(404).json({ error: "Session not found" });
  }

  try {
    const { userId } = req;
    const { accessToken, user, pages } = tokens;
    const { pageId } = req.body;

    let savedAccount;
    let selectedAccessToken = accessToken;
    let selectedPageData = null;

    if (pages && pages.length > 0 && pageId) {
      // User selected a specific page
      const selectedPage = pages.find(p => p.id === pageId);
      if (!selectedPage) {
        return res.status(400).json({ error: "Invalid page selection" });
      }
      
      selectedPageData = selectedPage;
      selectedAccessToken = selectedPage.access_token; // Use page access token
      
      const existingAccount = await SocialMediaAccount.findOne({
        userId: userId,
        platform: 'facebook',
        accountId: selectedPage.id
      });

      if (existingAccount) {
        // Update existing account
        existingAccount.accountName = selectedPage.name;
        existingAccount.accessToken = selectedPage.access_token;
        existingAccount.pageId = selectedPage.id;
        existingAccount.pageName = selectedPage.name;
        existingAccount.lastUsed = new Date();
        savedAccount = await existingAccount.save();
      } else {
        // Create new account
        const socialAccount = new SocialMediaAccount({
          userId: userId,
          platform: 'facebook',
          accountName: selectedPage.name,
          accountId: selectedPage.id,
          accessToken: selectedPage.access_token,
          pageId: selectedPage.id,
          pageName: selectedPage.name,
          isActive: true
        });
        savedAccount = await socialAccount.save();
      }
    } else {
      // No pages available or no page selected, use personal profile
      const existingAccount = await SocialMediaAccount.findOne({
        userId: userId,
        platform: 'facebook',
        accountId: user.id
      });

      if (existingAccount) {
        // Update existing account
        existingAccount.accountName = user.name;
        existingAccount.accessToken = accessToken;
        existingAccount.lastUsed = new Date();
        savedAccount = await existingAccount.save();
      } else {
        // Create new account
        const socialAccount = new SocialMediaAccount({
          userId: userId,
          platform: 'facebook',
          accountName: user.name,
          accountId: user.id,
          accessToken: accessToken,
          isActive: true
        });
        savedAccount = await socialAccount.save();
      }
    }

    // Return user data and clean up session
    const userData = {
      platform: "facebook",
      user: user,
      pages: pages || [],
      accessToken: selectedAccessToken,
      selectedPageId: pageId || user.id,
      selectedPage: selectedPageData,
      savedAccount: {
        id: savedAccount._id,
        accountName: savedAccount.accountName,
        accountId: savedAccount.accountId,
        platform: savedAccount.platform
      },
      timestamp: tokens.timestamp,
    };

    // Clean up session
    tokenUtils.removeTokens(sessionId);
    res.json(userData);

  } catch (error) {
    console.error('Error saving Facebook account:', error);
    
    // Clean up session on error
    tokenUtils.removeTokens(sessionId);
    
    // Send more detailed error information
    res.status(500).json({ 
      error: 'Failed to save Facebook account',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});
module.exports = router;
