const express = require("express");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();

const oauthConfig = require("../config/oauth");
const pkceUtils = require("../utils/pkce");
const tokenUtils = require("../utils/tokens");

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

// Step 3: Get Facebook user data
router.get("/user/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const tokens = tokenUtils.getTokens(sessionId);

  if (!tokens || tokens.platform !== "facebook") {
    return res.status(404).json({ error: "Session not found" });
  }

  // Return user data and clean up session
  const userData = {
    platform: "facebook",
    user: tokens.user,
    pages: tokens.pages,
    accessToken: tokens.accessToken,
    timestamp: tokens.timestamp,
  };

  tokenUtils.removeTokens(sessionId);
  res.json(userData);
});

module.exports = router;
