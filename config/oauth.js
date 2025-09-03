// ===============================
// config/oauth.js
// ===============================
module.exports = {
  twitter: {
    clientId: process.env.TWITTER_CLIENT_ID,
    clientSecret: process.env.TWITTER_CLIENT_SECRET,
    redirectUri: process.env.TWITTER_REDIRECT_URI,
    authUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    userUrl: 'https://api.twitter.com/2/users/me',
    scope: 'tweet.read tweet.write users.read offline.access'
  },
  linkedin: {
    clientId: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    redirectUri: process.env.LINKEDIN_REDIRECT_URI,
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    userUrl: 'https://api.linkedin.com/v2/people/~',
    scope: 'openid profile email w_member_social'
  },
  facebook: {
    clientId: process.env.FACEBOOK_APP_ID,
    clientSecret: process.env.FACEBOOK_APP_SECRET,
    authUrl: "https://www.facebook.com/v18.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v18.0/oauth/access_token",
    redirectUri: process.env.FACEBOOK_REDIRECT_URI,
    scope: "email public_profile pages_show_list pages_read_engagement",
    userUrl: "https://graph.facebook.com/v18.0/me"
  },
  // Instagram uses Facebook's Graph API for business accounts
  instagram: {
    clientId: process.env.INSTAGRAM_CLIENT_ID, // Same as Facebook App ID
    clientSecret: process.env.INSTAGRAM_CLIENT_SECRET, // Same as Facebook App Secret
    redirectUri: process.env.INSTAGRAM_REDIRECT_URI,
    authUrl: 'https://www.facebook.com/v18.0/dialog/oauth', // Uses Facebook OAuth
    tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token', // Uses Facebook token endpoint
    userUrl: 'https://graph.facebook.com/v18.0/me', // Uses Facebook user endpoint
    scope: 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,business_management'
  }
};
