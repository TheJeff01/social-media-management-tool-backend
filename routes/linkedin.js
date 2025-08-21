const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const oauthConfig = require('../config/oauth');
const tokenUtils = require('../utils/tokens');

// Step 1: Initiate LinkedIn OAuth
router.get('/', (req, res) => {
  try {
    const state = uuidv4(); // CSRF protection

    const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', oauthConfig.linkedin.clientId);
    authUrl.searchParams.append('redirect_uri', oauthConfig.linkedin.redirectUri);
    authUrl.searchParams.append('scope', 'openid profile email w_member_social'); // Required for id_token
    authUrl.searchParams.append('state', state);

    console.log('LinkedIn OAuth URL:', authUrl.toString());
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
    return res.redirect(`/linkedin-callback.html?error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.redirect(`/linkedin-callback.html?error=missing_code`);
  }

  try {
    // Step 1: Exchange authorization code for tokens
    const tokenResponse = await axios.post(
      'https://www.linkedin.com/oauth/v2/accessToken',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: oauthConfig.linkedin.redirectUri,
        client_id: oauthConfig.linkedin.clientId,
        client_secret: oauthConfig.linkedin.clientSecret,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
      }
    );

    console.log('Token exchange successful. Status:', tokenResponse.status);

    const { access_token, id_token } = tokenResponse.data;

    if (!access_token) {
      throw new Error('No access token received from LinkedIn');
    }

    if (!id_token) {
      throw new Error('No ID token received. Make sure scope includes "openid"');
    }

    // Step 2: Parse the ID token (JWT) to get user info
    console.log('Parsing user info from ID token...');
    const payload = id_token.split('.')[1];
    if (!payload) {
      throw new Error('Malformed ID token: missing payload');
    }

    const decodedPayload = Buffer.from(payload, 'base64').toString('utf-8');
    const userClaims = JSON.parse(decodedPayload);

    const userData = {
      id: userClaims.sub,           // Unique user ID
      firstName: userClaims.given_name,
      lastName: userClaims.family_name,
      email: userClaims.email || null,
      picture: userClaims.picture || null,
      name: userClaims.name,
      locale: userClaims.locale,
    };

    console.log('User data extracted from ID token:', userData);

    // Step 3: Create session
    const sessionId = uuidv4();
    tokenUtils.storeTokens(sessionId, {
      platform: 'linkedin',
      accessToken: access_token,
      idToken: id_token,
      user: userData,
      timestamp: new Date().toISOString(),
    });

    console.log('Session created with ID:', sessionId);

    // Redirect to frontend callback page with session ID
    res.redirect(`/linkedin-callback.html?success=true&session=${sessionId}`);
  } catch (error) {
    console.error('LinkedIn OAuth flow failed:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
      url: error.config?.url,
      stack: error.stack,
    });

    res.redirect(`/linkedin-callback.html?error=token_exchange_failed`);
  }
});

// Step 3: Retrieve user data using session ID
router.get('/user/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  console.log('Fetching user data for session:', sessionId);

  const tokens = tokenUtils.getTokens(sessionId);

  if (!tokens || tokens.platform !== 'linkedin') {
    console.log('Invalid or expired session');
    return res.status(404).json({ error: 'Session not found or invalid' });
  }

  const responseData = {
    platform: 'linkedin',
    user: tokens.user,
    accessToken: tokens.accessToken,
    timestamp: tokens.timestamp,
  };

  // Optional: Remove session after one-time use
  tokenUtils.removeTokens(sessionId);

  res.json(responseData);
});

module.exports = router;