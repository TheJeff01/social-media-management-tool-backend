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
    scope: 'r_liteprofile r_emailaddress w_member_social'
  },
  facebook: {
    clientId: process.env.FACEBOOK_APP_ID,
    clientSecret: process.env.FACEBOOK_APP_SECRET,
    redirectUri: process.env.FACEBOOK_REDIRECT_URI,
    authUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
    userUrl: 'https://graph.facebook.com/v18.0/me',
    scope: 'pages_manage_posts,pages_show_list,pages_read_engagement,public_profile'
  }
};