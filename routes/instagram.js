const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const oauthConfig = require('../config/oauth');
const pkceUtils = require('../utils/pkce');
const tokenUtils = require('../utils/tokens');

// Step 1: Initiate Instagram OAuth
router.get('/', (req, res) => {
  try {
    const state = pkceUtils.generateState();
    
    const authUrl = new URL(oauthConfig.instagram.authUrl);
    authUrl.searchParams.append('client_id', oauthConfig.instagram.clientId);
    authUrl.searchParams.append('redirect_uri', oauthConfig.instagram.redirectUri);
    authUrl.searchParams.append('scope', oauthConfig.instagram.scope);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('state', state);

    console.log('📷 Redirecting to Instagram OAuth:', authUrl.toString());
    res.redirect(authUrl.toString());
  } catch (error) {
    console.error('Instagram OAuth initiation error:', error);
    res.redirect(`/instagram-callback.html?error=auth_initiation_failed`);
  }
});

// Step 2: Handle Instagram OAuth callback
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error('Instagram OAuth error:', error);
    return res.redirect(`/instagram-callback.html?error=${error}`);
  }

  if (!code) {
    return res.redirect(`/instagram-callback.html?error=missing_code`);
  }

  try {
    // Exchange code for access token
    const tokenResponse = await axios.post(oauthConfig.instagram.tokenUrl, {
      client_id: oauthConfig.instagram.clientId,
      client_secret: oauthConfig.instagram.clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: oauthConfig.instagram.redirectUri,
      code: code
    }, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const { access_token, user_id } = tokenResponse.data;

    if (!access_token) {
      throw new Error('No access token received from Instagram');
    }

    // Get long-lived token (optional but recommended)
    let longLivedToken = access_token;
    try {
      const longLivedResponse = await axios.get(`https://graph.instagram.com/access_token`, {
        params: {
          grant_type: 'ig_exchange_token',
          client_secret: oauthConfig.instagram.clientSecret,
          access_token: access_token
        }
      });
      
      if (longLivedResponse.data.access_token) {
        longLivedToken = longLivedResponse.data.access_token;
        console.log('✅ Got long-lived Instagram token');
      }
    } catch (longLivedError) {
      console.warn('⚠️ Could not get long-lived token:', longLivedError.message);
      // Continue with short-lived token
    }

    // Get user profile data
    const userResponse = await axios.get(oauthConfig.instagram.userUrl, {
      params: {
        fields: 'id,username,account_type,media_count',
        access_token: longLivedToken
      }
    });

    const user = userResponse.data;

    // Create session
    const sessionId = uuidv4();
    tokenUtils.storeTokens(sessionId, {
      platform: 'instagram',
      accessToken: longLivedToken,
      userId: user_id,
      user: user
    });

    // Redirect to callback page with session ID for popup communication
    res.redirect(`/instagram-callback.html?success=true&session=${sessionId}`);

  } catch (error) {
    console.error('Instagram token exchange error:', error.response?.data || error.message);
    res.redirect(`/instagram-callback.html?error=token_exchange_failed`);
  }
});

// Step 3: Get Instagram user data
router.get('/user/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const tokens = tokenUtils.getTokens(sessionId);

  if (!tokens || tokens.platform !== 'instagram') {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Enhance user data with proper structure
  const enhancedUser = {
    id: tokens.user.id || tokens.userId,
    username: tokens.user.username || 'instagram_user',
    name: tokens.user.username || 'Instagram User', // Instagram Basic Display doesn't provide display name
    account_type: tokens.user.account_type || 'PERSONAL',
    media_count: tokens.user.media_count || 0,
    // Note: Instagram Basic Display API doesn't provide follower count for privacy
    followers_count: null,
    profile_picture_url: null // Not available in Instagram Basic Display API
  };

  // Return user data and clean up session
  const userData = {
    platform: 'instagram',
    user: enhancedUser,
    accessToken: tokens.accessToken,
    timestamp: tokens.timestamp
  };

  tokenUtils.removeTokens(sessionId);
  res.json(userData);
});

module.exports = router;