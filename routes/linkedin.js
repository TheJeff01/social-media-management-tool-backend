const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const oauthConfig = require('../config/oauth');
const pkceUtils = require('../utils/pkce');
const tokenUtils = require('../utils/tokens');

// Step 1: Initiate LinkedIn OAuth
router.get('/', (req, res) => {
  try {
    const state = pkceUtils.generateState();
    
    const authUrl = new URL(oauthConfig.linkedin.authUrl);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', oauthConfig.linkedin.clientId);
    authUrl.searchParams.append('redirect_uri', oauthConfig.linkedin.redirectUri);
    authUrl.searchParams.append('scope', oauthConfig.linkedin.scope);
    authUrl.searchParams.append('state', state);

    console.log('LinkedIn OAuth URL:', authUrl.toString());
    console.log('Using client ID:', oauthConfig.linkedin.clientId);
    console.log('Using redirect URI:', oauthConfig.linkedin.redirectUri);
    console.log('Using scope:', oauthConfig.linkedin.scope);
    
    res.redirect(authUrl.toString());
  } catch (error) {
    console.error('LinkedIn OAuth initiation error:', error);
    res.redirect(`/linkedin-callback.html?error=auth_initiation_failed`);
  }
});

// Step 2: Handle LinkedIn OAuth callback
router.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  console.log('LinkedIn callback received:');
  console.log('Code:', code ? code.substring(0, 20) + '...' : 'None');
  console.log('State:', state);
  console.log('Error:', error);
  console.log('Error Description:', error_description);

  if (error) {
    console.error('LinkedIn OAuth error:', error, error_description);
    return res.redirect(`/linkedin-callback.html?error=${error}`);
  }

  if (!code) {
    return res.redirect(`/linkedin-callback.html?error=missing_code`);
  }

  try {
    console.log('Starting LinkedIn token exchange...');
    console.log('Token URL:', oauthConfig.linkedin.tokenUrl);
    
    // Prepare token exchange data
    const tokenData = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: oauthConfig.linkedin.redirectUri,
      client_id: oauthConfig.linkedin.clientId,
      client_secret: oauthConfig.linkedin.clientSecret
    });

    console.log('Token exchange data:', {
      grant_type: 'authorization_code',
      code: code.substring(0, 20) + '...',
      redirect_uri: oauthConfig.linkedin.redirectUri,
      client_id: oauthConfig.linkedin.clientId,
      client_secret: oauthConfig.linkedin.clientSecret ? 'Present' : 'Missing'
    });

    // Exchange code for tokens
    const tokenResponse = await axios.post(oauthConfig.linkedin.tokenUrl, tokenData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      }
    });

    console.log('LinkedIn token response status:', tokenResponse.status);
    console.log('LinkedIn token response data:', tokenResponse.data);

    const { access_token } = tokenResponse.data;

    if (!access_token) {
      throw new Error('No access token received from LinkedIn');
    }

    console.log('Access token received, length:', access_token.length);

    // Get user profile - Updated for LinkedIn v2 API
    console.log('Parsing user info from ID token...');
    
    // Use the correct LinkedIn v2 API endpoint
    const userResponse = await axios.get('https://api.linkedin.com/v2/people/~', {
      params: {
        projection: '(id,localizedFirstName,localizedLastName,profilePicture(displayImage~:playableStreams))'
      },
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Accept': 'application/json'
      }
    });

    console.log('LinkedIn user response status:', userResponse.status);
    console.log('LinkedIn user data:', userResponse.data);

    const user = userResponse.data;
    
    // Create session
    const sessionId = uuidv4();
    tokenUtils.storeTokens(sessionId, {
      platform: 'linkedin',
      accessToken: access_token,
      user: user
    });

    console.log('Session created with ID:', sessionId);

    // Redirect to callback page with session ID for popup communication
    res.redirect(`/linkedin-callback.html?success=true&session=${sessionId}`);

  } catch (error) {
    console.error('LinkedIn token exchange detailed error:');
    console.error('Error message:', error.message);
    console.error('Response status:', error.response?.status);
    console.error('Response status text:', error.response?.statusText);
    console.error('Response headers:', error.response?.headers);
    console.error('Response data:', error.response?.data);
    console.error('Request URL:', error.config?.url);
    console.error('Request method:', error.config?.method);
    console.error('Request headers:', error.config?.headers);
    console.error('Request data:', error.config?.data);
    
    res.redirect(`/linkedin-callback.html?error=token_exchange_failed`);
  }
});

// Step 3: Get LinkedIn user data
router.get('/user/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  console.log('Fetching user data for session:', sessionId);
  
  const tokens = tokenUtils.getTokens(sessionId);

  if (!tokens || tokens.platform !== 'linkedin') {
    console.log('Session not found or wrong platform');
    return res.status(404).json({ error: 'Session not found' });
  }

  console.log('LinkedIn user data found:', {
    platform: tokens.platform,
    hasAccessToken: !!tokens.accessToken,
    hasUser: !!tokens.user,
    userId: tokens.user?.id
  });

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