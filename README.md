# Social Media Backend API

A Node.js/Express backend API for social media OAuth authentication and cross-platform posting. Supports Twitter, LinkedIn, Facebook, and Instagram integration with secure OAuth 2.0 flows.

## 🚀 Features

- **Multi-Platform OAuth**: Secure authentication for Twitter, LinkedIn, Facebook, and Instagram
- **Cross-Platform Posting**: Post text and images to multiple social media platforms simultaneously
- **Image Upload Support**: Handle both file uploads and URL-based images
- **PKCE Security**: Implements Proof Key for Code Exchange for enhanced OAuth security
- **Popup-Based Auth**: Seamless authentication flow with popup windows
- **Session Management**: Temporary session storage for OAuth tokens
- **Error Handling**: Comprehensive error reporting and debugging

## 📋 Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Social media app credentials for each platform you want to integrate

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd social-media-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your credentials (see Configuration section)

4. **Start the development server**
   ```bash
   npm run dev
   ```

5. **Start the production server**
   ```bash
   npm start
   ```

The server will run on `http://localhost:3001` by default.

## ⚙️ Configuration

### Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Server Configuration
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# Session Secret
SESSION_SECRET=your_random_session_secret_here

# Twitter OAuth 2.0 Credentials
TWITTER_CLIENT_ID=your_twitter_client_id
TWITTER_CLIENT_SECRET=your_twitter_client_secret
TWITTER_REDIRECT_URI=http://localhost:3001/auth/twitter/callback

# LinkedIn OAuth 2.0 Credentials
LINKEDIN_CLIENT_ID=your_linkedin_client_id
LINKEDIN_CLIENT_SECRET=your_linkedin_client_secret
LINKEDIN_REDIRECT_URI=http://localhost:3001/auth/linkedin/callback

# Facebook OAuth 2.0 Credentials
FACEBOOK_APP_ID=your_facebook_app_id
FACEBOOK_APP_SECRET=your_facebook_app_secret
FACEBOOK_REDIRECT_URI=http://localhost:3001/auth/facebook/callback

# Instagram OAuth 2.0 Credentials (Basic Display API)
INSTAGRAM_CLIENT_ID=your_instagram_client_id
INSTAGRAM_CLIENT_SECRET=your_instagram_client_secret
INSTAGRAM_REDIRECT_URI=http://localhost:3001/auth/instagram/callback
```

### Social Media App Setup

#### Twitter App Setup
1. Go to [Twitter Developer Portal](https://developer.twitter.com/)
2. Create a new app or use existing one
3. Enable OAuth 2.0 with PKCE
4. Set callback URL: `http://localhost:3001/auth/twitter/callback`
5. Required scopes: `tweet.read tweet.write users.read offline.access`

#### LinkedIn App Setup
1. Go to [LinkedIn Developer Portal](https://www.linkedin.com/developers/)
2. Create a new app
3. Request access to "Sign In with LinkedIn" and "Share on LinkedIn" products
4. Set redirect URL: `http://localhost:3001/auth/linkedin/callback`
5. Required scopes: `openid profile email w_member_social`

#### Facebook App Setup
1. Go to [Facebook Developers](https://developers.facebook.com/)
2. Create a new app (Business type recommended)
3. Add Facebook Login product
4. Set Valid OAuth Redirect URIs: `http://localhost:3001/auth/facebook/callback`
5. Required permissions: `pages_manage_posts pages_show_list pages_read_engagement public_profile`

#### Instagram App Setup
1. Use the same Facebook app as above
2. Add Instagram Basic Display product
3. Set redirect URI: `http://localhost:3001/auth/instagram/callback`
4. Required scopes: `user_profile user_media`

## 📚 API Documentation

### Authentication Endpoints

#### Initiate OAuth Flow
```
GET /auth/{platform}
```
Redirects user to the social media platform's OAuth authorization page.

**Supported platforms:** `twitter`, `linkedin`, `facebook`, `instagram`

**Example:**
```
GET /auth/twitter
```

#### OAuth Callback
```
GET /auth/{platform}/callback
```
Handles the OAuth callback and displays a popup completion page.

#### Get User Data
```
GET /auth/{platform}/user/{sessionId}
```
Retrieves authenticated user data using the session ID from the callback.

**Response:**
```json
{
  "platform": "twitter",
  "user": {
    "id": "123456789",
    "username": "johndoe",
    "name": "John Doe"
  },
  "accessToken": "...",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

### Posting Endpoints

#### Single Platform Posting
```
POST /api/posting/{platform}
```

**Supported platforms:** `twitter`, `facebook`, `linkedin`

**Form Data Parameters:**
- `content` (string): Post text content
- `image` (file): Image file upload (optional)
- `imageUrl` (string): Image URL (optional)
- Platform-specific credentials:
  - **Twitter**: `accessToken`
  - **Facebook**: `pageId`, `pageToken`
  - **LinkedIn**: `accessToken`, `userId`

**Example Request:**
```javascript
const formData = new FormData();
formData.append('content', 'Hello, world!');
formData.append('accessToken', 'your_access_token');

fetch('/api/posting/twitter', {
  method: 'POST',
  body: formData
});
```

**Response:**
```json
{
  "success": true,
  "platform": "Twitter",
  "postId": "1234567890",
  "message": "Tweet posted successfully!",
  "url": "https://twitter.com/i/status/1234567890"
}
```

#### Multi-Platform Posting
```
POST /api/posting/multi
```

**Form Data Parameters:**
- `content` (string): Post text content
- `platforms` (JSON string): Array of platform names
- `credentials` (JSON string): Object containing all platform credentials
- `image` (file): Image file upload (optional)
- `imageUrl` (string): Image URL (optional)

**Example Request:**
```javascript
const formData = new FormData();
formData.append('content', 'Hello from all platforms!');
formData.append('platforms', JSON.stringify(['Twitter', 'LinkedIn']));
formData.append('credentials', JSON.stringify({
  twitter: { accessToken: 'twitter_token' },
  linkedin: { accessToken: 'linkedin_token', userId: 'linkedin_user_id' }
}));

fetch('/api/posting/multi', {
  method: 'POST',
  body: formData
});
```

**Response:**
```json
{
  "success": true,
  "totalPlatforms": 2,
  "successful": 2,
  "failed": 0,
  "results": [
    {
      "platform": "Twitter",
      "success": true,
      "result": { "postId": "123", "message": "Tweet posted successfully!" }
    },
    {
      "platform": "LinkedIn",
      "success": true,
      "result": { "postId": "456", "message": "LinkedIn post published successfully!" }
    }
  ]
}
```

### Utility Endpoints

#### Health Check
```
GET /
```
Returns server status and available endpoints.

#### Auth Service Status
```
GET /auth/status
```
Returns authentication service status and available providers.

## 🏗️ Project Structure

```
social-media-backend/
├── config/
│   └── oauth.js              # OAuth configuration for all platforms
├── middleware/
│   └── cors.js              # CORS configuration
├── public/                  # Static callback pages
│   ├── twitter-callback.html
│   ├── linkedin-callback.html
│   ├── facebook-callback.html
│   └── instagram-callback.html
├── routes/
│   ├── auth.js             # General auth routes
│   ├── twitter.js          # Twitter OAuth implementation
│   ├── linkedin.js         # LinkedIn OAuth implementation
│   ├── facebook.js         # Facebook OAuth implementation
│   ├── instagram.js        # Instagram OAuth implementation
│   └── posting.js          # Social media posting logic
├── utils/
│   ├── pkce.js            # PKCE utilities for OAuth security
│   └── tokens.js          # Token storage and management
├── .env                   # Environment variables
├── .gitignore
├── package.json
├── server.js              # Main server file
└── README.md
```

## 🔒 Security Features

- **PKCE (Proof Key for Code Exchange)**: Implements PKCE for OAuth 2.0 flows to prevent authorization code interception attacks
- **CORS Protection**: Configurable CORS settings to control frontend access
- **Session Management**: Temporary token storage with automatic cleanup
- **Input Validation**: File upload restrictions and content validation
- **Error Handling**: Secure error messages that don't leak sensitive information

## 🚨 Known Limitations

### Twitter Image Uploads
**Issue**: Twitter's media upload API (v1.1) requires OAuth 1.0a authentication, but this implementation uses OAuth 2.0 Bearer tokens.

**Current Behavior**: 
- Text-only tweets work perfectly
- Image uploads will fail with 401 error
- Multi-platform posts will post images to other platforms but text-only to Twitter

**Workarounds**:
1. Use text-only posts for Twitter
2. Post images to other platforms simultaneously
3. For full Twitter image support, implement OAuth 1.0a flow

### Platform-Specific Notes

- **LinkedIn**: Supports images through a complex 3-step upload process (implemented)
- **Facebook**: Requires page-level permissions for business accounts
- **Instagram**: Uses Basic Display API (read-only), posting not currently supported
- **Twitter**: OAuth 2.0 Bearer tokens only work for text posts

## 🛠️ Development

### Running in Development Mode
```bash
npm run dev
```
Uses nodemon for automatic server restarts on file changes.

### Environment Setup
- **Development**: `NODE_ENV=development` (enables detailed error messages)
- **Production**: `NODE_ENV=production` (minimal error exposure)

### Debugging
Enable detailed logging by checking the console output. Each platform has comprehensive logging for troubleshooting OAuth flows and posting issues.

### Testing OAuth Flows
1. Start the backend server
2. Navigate to `http://localhost:3001/auth/{platform}` in your browser
3. Complete the OAuth flow
4. Check server console for session creation
5. Test posting via API endpoints

## 📝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/new-platform`)
3. Commit your changes (`git commit -am 'Add new platform support'`)
4. Push to the branch (`git push origin feature/new-platform`)
5. Create a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

If you encounter issues:

1. **Check the console logs** - Both frontend and backend provide detailed debugging information
2. **Verify environment variables** - Ensure all required OAuth credentials are set
3. **Test individual platform flows** - Use the health check endpoints to verify setup
4. **Review OAuth app settings** - Ensure callback URLs and permissions are correctly configured

## 🔄 Changelog

### v1.0.0
- Initial release with Twitter, LinkedIn, Facebook, and Instagram OAuth
- Multi-platform posting support
- Image upload capabilities (except Twitter)
- PKCE security implementation
- Comprehensive error handling and logging