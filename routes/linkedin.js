const express = require("express");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();
const jwt = require('jsonwebtoken');
const SocialMediaAccount = require('../models/SocialMediaAccount');

const oauthConfig = require("../config/oauth");
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

// --- Helper: Retry wrapper for LinkedIn API ---
async function apiCallWithRetry(url, options, retries = 3) {
  try {
    const res = await axios({ url, ...options });
    return res.data;
  } catch (err) {
    if (retries > 0) {
      console.log("Retrying LinkedIn API call...", retries, err.message);
      await new Promise((r) => setTimeout(r, 2000));
      return apiCallWithRetry(url, options, retries - 1);
    }
    throw err;
  }
}

// --- Step 1: Initiate LinkedIn OAuth ---
router.get("/", (req, res) => {
  try {
    const state = uuidv4(); // CSRF protection

    const authUrl = new URL("https://www.linkedin.com/oauth/v2/authorization");
    authUrl.searchParams.append("response_type", "code");
    authUrl.searchParams.append("client_id", oauthConfig.linkedin.clientId);
    authUrl.searchParams.append("redirect_uri", oauthConfig.linkedin.redirectUri);
    authUrl.searchParams.append("scope", "openid profile email w_member_social");
    authUrl.searchParams.append("state", state);

    console.log("LinkedIn OAuth URL:", authUrl.toString());
    res.redirect(authUrl.toString());
  } catch (error) {
    console.error("LinkedIn OAuth initiation error:", error);
    res.redirect(`/linkedin-callback.html?error=auth_initiation_failed`);
  }
});

// --- Step 2: Handle LinkedIn OAuth callback ---
router.get("/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query;

  console.log("LinkedIn callback received:");
  console.log("Code:", code ? code.substring(0, 20) + "..." : "None");
  console.log("State:", state);
  console.log("Error:", error);
  console.log("Error Description:", error_description);

  if (error) {
    console.error("LinkedIn OAuth error:", error, error_description);
    return res.redirect(`/linkedin-callback.html?error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.redirect(`/linkedin-callback.html?error=missing_code`);
  }

  try {
    // Exchange authorization code for tokens
    const tokenResponse = await axios.post(
      "https://www.linkedin.com/oauth/v2/accessToken",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: oauthConfig.linkedin.redirectUri,
        client_id: oauthConfig.linkedin.clientId,
        client_secret: oauthConfig.linkedin.clientSecret,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
      }
    );

    console.log("Token exchange successful. Status:", tokenResponse.status);

    const { access_token, id_token } = tokenResponse.data;

    if (!access_token) throw new Error("No access token received from LinkedIn");
    if (!id_token) throw new Error('No ID token received. Make sure scope includes "openid"');

    // Parse ID token (JWT) to get user info
    console.log("Parsing user info from ID token...");
    const payload = id_token.split(".")[1];
    if (!payload) throw new Error("Malformed ID token: missing payload");

    const decodedPayload = Buffer.from(payload, "base64").toString("utf-8");
    const userClaims = JSON.parse(decodedPayload);

    const userData = {
      id: userClaims.sub,
      firstName: userClaims.given_name,
      lastName: userClaims.family_name,
      email: userClaims.email || null,
      picture: userClaims.picture || null,
      name: userClaims.name,
      locale: userClaims.locale,
    };

    console.log("User data extracted from ID token:", userData);

    // Create session
    const sessionId = uuidv4();
    tokenUtils.storeTokens(sessionId, {
      platform: "linkedin",
      accessToken: access_token,
      idToken: id_token,
      user: userData,
      timestamp: new Date().toISOString(),
    });

    console.log("Session created with ID:", sessionId);

    res.redirect(`/linkedin-callback.html?success=true&session=${sessionId}`);
  } catch (error) {
    console.error("LinkedIn OAuth flow failed:", {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
      url: error.config?.url,
      stack: error.stack,
    });

    res.redirect(`/linkedin-callback.html?error=token_exchange_failed`);
  }
});

// --- Step 3: Retrieve user data using session ID and save to database ---
router.get("/user/:sessionId", authenticateUser, async (req, res) => {
  const { sessionId } = req.params;
  console.log("Fetching user data for session:", sessionId);

  const tokens = tokenUtils.getTokens(sessionId);

  if (!tokens || tokens.platform !== "linkedin") {
    console.log("Invalid or expired session");
    return res.status(404).json({ error: "Session not found or invalid" });
  }

  try {
    const { userId } = req;
    const { accessToken, user } = tokens;

    // Save or update LinkedIn account in database
    const existingAccount = await SocialMediaAccount.findOne({
      userId: userId,
      platform: 'linkedin',
      accountId: user.id
    });

    if (existingAccount) {
      // Update existing account
      existingAccount.accountName = user.name;
      existingAccount.accessToken = accessToken;
      existingAccount.linkedinUserId = user.id;
      existingAccount.lastUsed = new Date();
      await existingAccount.save();
    } else {
      // Create new account
      const socialAccount = new SocialMediaAccount({
        userId: userId,
        platform: 'linkedin',
        accountName: user.name,
        accountId: user.id,
        accessToken: accessToken,
        linkedinUserId: user.id,
        isActive: true
      });
      await socialAccount.save();
    }

    const responseData = {
      platform: "linkedin",
      user: user,
      accessToken: accessToken,
      timestamp: tokens.timestamp,
    };

    // Remove session after one-time use
    tokenUtils.removeTokens(sessionId);

    res.json(responseData);

  } catch (error) {
    console.error('Error saving LinkedIn account:', error);
    tokenUtils.removeTokens(sessionId);
    res.status(500).json({ error: 'Failed to save LinkedIn account' });
  }
});

// --- Step 4: Post to LinkedIn ---
router.post("/post/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const { message } = req.body;

  const tokens = tokenUtils.getTokens(sessionId);
  if (!tokens) return res.status(401).json({ error: "Invalid session" });

  try {
    // Get user profile to retrieve LinkedIn URN
    const profile = await apiCallWithRetry("https://api.linkedin.com/v2/me", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });

    // Build LinkedIn post body
    const postBody = {
      author: `urn:li:person:${profile.id}`,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: message },
          shareMediaCategory: "NONE",
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    };

    const postResponse = await apiCallWithRetry("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      data: postBody,
    });

    res.json({ success: true, post: postResponse });
  } catch (err) {
    console.error("LinkedIn posting failed:", err.message);
    res.status(500).json({ error: "LinkedIn posting failed", details: err.message });
  }
});

module.exports = router;
