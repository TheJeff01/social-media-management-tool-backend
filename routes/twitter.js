const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const router = express.Router();
const jwt = require('jsonwebtoken');
const SocialMediaAccount = require('../models/SocialMediaAccount');

const oauthConfig = require('../config/oauth');
const pkceUtils = require('../utils/pkce');
const tokenUtils = require('../utils/tokens');

// Store PKCE challenges temporarily
const pkceStore = new Map();

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

// Step 1: Initiate Twitter OAuth (same as before)
router.get('/', (req, res) => {
  try {
    const state = pkceUtils.generateState();
    const codeVerifier = pkceUtils.generateRandomString(128);
    const codeChallenge = pkceUtils.generateCodeChallenge(codeVerifier);
    
    // Store PKCE verifier with state
    pkceStore.set(state, codeVerifier);
    
    const authUrl = new URL(oauthConfig.twitter.authUrl);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', oauthConfig.twitter.clientId);
    authUrl.searchParams.append('redirect_uri', oauthConfig.twitter.redirectUri);
    authUrl.searchParams.append('scope', oauthConfig.twitter.scope);
    authUrl.searchParams.append('state', state);
    authUrl.searchParams.append('code_challenge', codeChallenge);
    authUrl.searchParams.append('code_challenge_method', 'S256');

    console.log('🐦 Redirecting to Twitter OAuth:', authUrl.toString());
    res.redirect(authUrl.toString());
  } catch (error) {
    console.error('Twitter OAuth initiation error:', error);
    res.redirect(`/twitter-callback.html?error=auth_initiation_failed`);
  }
});

// Step 2: Handle Twitter OAuth callback - Modified for popup
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error('Twitter OAuth error:', error);
    return res.redirect(`/twitter-callback.html?error=${error}`);
  }

  if (!code || !state) {
    return res.redirect(`/twitter-callback.html?error=missing_params`);
  }

  try {
    // Get stored PKCE verifier
    const codeVerifier = pkceStore.get(state);
    if (!codeVerifier) {
      return res.redirect(`/twitter-callback.html?error=invalid_state`);
    }

    // Clean up PKCE store
    pkceStore.delete(state);

    // Exchange code for tokens
    const tokenResponse = await axios.post(oauthConfig.twitter.tokenUrl, new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: oauthConfig.twitter.redirectUri,
      code_verifier: codeVerifier,
      client_id: oauthConfig.twitter.clientId
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${oauthConfig.twitter.clientId}:${oauthConfig.twitter.clientSecret}`).toString('base64')}`
      }
    });

    const { access_token, refresh_token } = tokenResponse.data;

    // Get user profile
    const userResponse = await axios.get(
      `${oauthConfig.twitter.userUrl}?user.fields=profile_image_url,public_metrics,name,username`,
      {
        headers: {
          'Authorization': `Bearer ${access_token}`
        }
      }
    );

    const user = userResponse.data.data;
    
    // Create session
    const sessionId = uuidv4();
    tokenUtils.storeTokens(sessionId, {
      platform: 'twitter',
      accessToken: access_token,
      refreshToken: refresh_token,
      user: user
    });

    // Redirect to callback page with session ID for popup communication
    res.redirect(`/twitter-callback.html?success=true&session=${sessionId}`);

  } catch (error) {
    console.error('Twitter token exchange error:', error.response?.data || error.message);
    res.redirect(`/twitter-callback.html?error=token_exchange_failed`);
  }
});

// Step 3: Get Twitter user data and save to database
router.get('/user/:sessionId', authenticateUser, async (req, res) => {
  const { sessionId } = req.params;
  const tokens = tokenUtils.getTokens(sessionId);

  if (!tokens || tokens.platform !== 'twitter') {
    return res.status(404).json({ error: 'Session not found' });
  }

  try {
    const { userId } = req;
    const { accessToken, refreshToken, user } = tokens;

    // Save or update Twitter account in database
    const existingAccount = await SocialMediaAccount.findOne({
      userId: userId,
      platform: 'twitter',
      accountId: user.id
    });

    if (existingAccount) {
      // Update existing account
      existingAccount.accountName = user.name;
      existingAccount.accessToken = accessToken;
      existingAccount.refreshToken = refreshToken;
      existingAccount.lastUsed = new Date();
      await existingAccount.save();
    } else {
      // Create new account
      const socialAccount = new SocialMediaAccount({
        userId: userId,
        platform: 'twitter',
        accountName: user.name,
        accountId: user.id,
        accessToken: accessToken,
        refreshToken: refreshToken,
        isActive: true
      });
      await socialAccount.save();
    }

    // Return user data and clean up session
    const userData = {
      platform: 'twitter',
      user: user,
      accessToken: accessToken,
      timestamp: tokens.timestamp
    };

    tokenUtils.removeTokens(sessionId);
    res.json(userData);

  } catch (error) {
    console.error('Error saving Twitter account:', error);
    tokenUtils.removeTokens(sessionId);
    res.status(500).json({ error: 'Failed to save Twitter account' });
  }
});

module.exports = router;
