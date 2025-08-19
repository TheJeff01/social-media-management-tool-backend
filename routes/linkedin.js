const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const oauthConfig = require('../config/oauth');
const pkceUtils = require('../utils/pkce');
const tokenUtils = require('../utils/tokens');

// Step 1: Initiate LinkedIn OAuth (same as before)
router.get('/', (req, res) => {
  try {
    const state = pkceUtils.generateState();
    
    const authUrl = new URL(oauthConfig.linkedin.authUrl);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', oauthConfig.linkedin.clientId);
    authUrl.searchParams.append('redirect_uri', oauthConfig.linkedin.redirectUri);
    authUrl.searchParams.append('scope', oauthConfig.linkedin.scope);
    authUrl.searchParams.append('state', state);

    console.log('💼 Redirecting to LinkedIn OAuth:', authUrl.toString());
    res.redirect(authUrl.toString());
  } catch (error) {
    console.error('LinkedIn OAuth initiation error:', error);
    res.redirect(`/linkedin-callback.html?error=auth_initiation_failed`);
  }
});

// Step 2: Handle LinkedIn OAuth callback - Modified for popup
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error('LinkedIn OAuth error:', error);
    return res.redirect(`/linkedin-callback.html?error=${error}`);
  }

  if (!code) {
    return res.redirect(`/linkedin-callback.html?error=missing_code`);
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await axios.post(oauthConfig.linkedin.tokenUrl, new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: oauthConfig.linkedin.redirectUri,
      client_id: oauthConfig.linkedin.clientId,
      client_secret: oauthConfig.linkedin.clientSecret
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const { access_token } = tokenResponse.data;

    // Get user profile
    const userResponse = await axios.get(
      `${oauthConfig.linkedin.userUrl}?projection=(id,firstName,lastName,profilePicture(displayImage~:playableStreams))`,
      {
        headers: {
          'Authorization': `Bearer ${access_token}`
        }
      }
    );

    const user = userResponse.data;
    
    // Create session
    const sessionId = uuidv4();
    tokenUtils.storeTokens(sessionId, {
      platform: 'linkedin',
      accessToken: access_token,
      user: user
    });

    // Redirect to callback page with session ID for popup communication
    res.redirect(`/linkedin-callback.html?success=true&session=${sessionId}`);

  } catch (error) {
    console.error('LinkedIn token exchange error:', error.response?.data || error.message);
    res.redirect(`/linkedin-callback.html?error=token_exchange_failed`);
  }
});

// Step 3: Get LinkedIn user data (same as before)
router.get('/user/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const tokens = tokenUtils.getTokens(sessionId);

  if (!tokens || tokens.platform !== 'linkedin') {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Return user data and clean up session
  const userData = {
    platform: 'linkedin',
    user: tokens.user,
    accessToken: tokens.accessToken,
    timestamp: tokens.timestamp
  };

  tokenUtils.removeTokens(sessionId);
  res.json(userData);
});

module.exports = router;