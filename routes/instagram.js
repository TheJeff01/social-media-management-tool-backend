const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const oauthConfig = require('../config/oauth');
const pkceUtils = require('../utils/pkce');
const tokenUtils = require('../utils/tokens');

// Step 1: Initiate Instagram OAuth (via Facebook)
router.get('/', (req, res) => {
  try {
    const state = pkceUtils.generateState();
    
    // Use Facebook OAuth for Instagram - this is the correct approach
    const authUrl = new URL('https://www.facebook.com/v18.0/dialog/oauth');
    authUrl.searchParams.append('client_id', oauthConfig.instagram.clientId); // Same as Facebook App ID
    authUrl.searchParams.append('redirect_uri', oauthConfig.instagram.redirectUri);
    // Instagram Graph API scopes for business accounts
    authUrl.searchParams.append('scope', 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,business_management');
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('state', state);

    console.log('📷 Redirecting to Instagram Graph API OAuth (via Facebook):', authUrl.toString());
    res.redirect(authUrl.toString());
  } catch (error) {
    console.error('Instagram OAuth initiation error:', error);
    res.redirect(`/instagram-callback.html?error=auth_initiation_failed`);
  }
});

// Step 2: Handle Instagram OAuth callback
router.get('/callback', async (req, res) => {
  const { code, state, error, error_reason, error_description } = req.query;

  console.log('Instagram callback received:', {
    code: code ? 'present' : undefined,
    error,
    error_reason,
    error_description
  });

  if (error) {
    console.error('Instagram OAuth error:', error, error_description);
    return res.redirect(`/instagram-callback.html?error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.redirect(`/instagram-callback.html?error=missing_code`);
  }

  try {
    console.log('📷 Exchanging code for Instagram access token...');

    // Step 1: Exchange code for Facebook access token
    const tokenResponse = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        client_id: oauthConfig.instagram.clientId,
        client_secret: oauthConfig.instagram.clientSecret,
        redirect_uri: oauthConfig.instagram.redirectUri,
        code: code
      }
    });

    const { access_token } = tokenResponse.data;

    if (!access_token) {
      throw new Error('No access token received from Facebook');
    }

    console.log('✅ Facebook access token received');

    // Step 2: Get user's Facebook pages (which may be connected to Instagram)
    const pagesResponse = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
      params: {
        access_token: access_token,
        fields: 'id,name,access_token,instagram_business_account'
      }
    });

    const pages = pagesResponse.data.data || [];
    console.log('📄 Found pages:', pages.length);

    // Step 3: Find pages with Instagram business accounts
    let instagramAccounts = [];
    
    for (const page of pages) {
      if (page.instagram_business_account) {
        try {
          // Get Instagram account details
          const igResponse = await axios.get(`https://graph.facebook.com/v18.0/${page.instagram_business_account.id}`, {
            params: {
              fields: 'id,username,name,biography,profile_picture_url,followers_count,follows_count,media_count',
              access_token: page.access_token
            }
          });

          instagramAccounts.push({
            ...igResponse.data,
            page_id: page.id,
            page_name: page.name,
            page_access_token: page.access_token
          });

          console.log('📷 Found Instagram account:', igResponse.data.username);
        } catch (igError) {
          console.warn('⚠️ Could not fetch Instagram account details:', igError.message);
        }
      }
    }

    if (instagramAccounts.length === 0) {
      console.warn('⚠️ No Instagram business accounts found');
      return res.redirect(`/instagram-callback.html?error=no_instagram_accounts`);
    }

    // Step 4: Get basic user profile from Facebook
    const userResponse = await axios.get('https://graph.facebook.com/v18.0/me', {
      params: {
        fields: 'id,name,email,picture',
        access_token: access_token
      }
    });

    const user = userResponse.data;

    // Step 5: Create session with all data
    const sessionId = uuidv4();
    tokenUtils.storeTokens(sessionId, {
      platform: 'instagram',
      accessToken: access_token,
      user: user,
      instagramAccounts: instagramAccounts,
      pages: pages
    });

    console.log('✅ Instagram OAuth flow completed successfully');

    // Redirect to callback page with session ID for popup communication
    res.redirect(`/instagram-callback.html?success=true&session=${sessionId}`);

  } catch (error) {
    console.error('❌ Instagram token exchange failed:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data
    });
    
    const errorMessage = error.response?.data?.error?.message || 'token_exchange_failed';
    res.redirect(`/instagram-callback.html?error=${encodeURIComponent(errorMessage)}`);
  }
});

// Step 3: Get Instagram user data
router.get('/user/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const tokens = tokenUtils.getTokens(sessionId);

  if (!tokens || tokens.platform !== 'instagram') {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Prepare response data
  const responseData = {
    platform: 'instagram',
    user: tokens.user,
    instagramAccounts: tokens.instagramAccounts,
    accessToken: tokens.accessToken,
    timestamp: tokens.timestamp
  };

  // Clean up session after use
  tokenUtils.removeTokens(sessionId);
  res.json(responseData);
});

module.exports = router;