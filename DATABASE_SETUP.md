# Database Setup Guide

This guide will help you set up the MongoDB database for storing user accounts and social media credentials.

## Prerequisites

1. **MongoDB installed** on your system
2. **Node.js and npm** installed
3. **All required npm packages** installed

## Step 1: Install MongoDB (if not already installed)

### Windows:
1. Download MongoDB Community Server from [mongodb.com](https://www.mongodb.com/try/download/community)
2. Install with default settings
3. MongoDB will run as a Windows service automatically

### macOS:
```bash
brew install mongodb-community
brew services start mongodb-community
```

### Linux (Ubuntu):
```bash
sudo apt update
sudo apt install mongodb
sudo systemctl start mongodb
sudo systemctl enable mongodb
```

## Step 2: Create Environment File

Create a `.env` file in the backend directory with the following content:

```env
# Server Configuration
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# MongoDB Connection (Local)
MONGODB_URI=mongodb://localhost:27017/social-media-app

# JWT Secret
JWT_SECRET=your_super_secret_jwt_key_here_change_this_in_production

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

# Instagram OAuth 2.0 Credentials
INSTAGRAM_CLIENT_ID=your_instagram_client_id
INSTAGRAM_CLIENT_SECRET=your_instagram_client_secret
INSTAGRAM_REDIRECT_URI=http://localhost:3001/auth/instagram/callback

# Cloudinary Configuration
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret
```

## Step 3: Test Database Connection

Run the database setup script:

```bash
node scripts/setup-db.js
```

This will:
- Test the MongoDB connection
- Create necessary database indexes
- Verify the models work correctly

## Step 4: Start the Server

```bash
npm run dev
```

## Step 5: Test the API Endpoints

### Register a new user:
```bash
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@example.com",
    "password": "password123",
    "firstName": "Test",
    "lastName": "User"
  }'
```

### Login:
```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'
```

### Get user profile (requires token):
```bash
curl -X GET http://localhost:3001/auth/profile \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Database Models

### User Model
- `username`: Unique username
- `email`: Unique email address
- `password`: Hashed password
- `firstName`, `lastName`: User's name
- `isActive`: Account status
- `lastLogin`: Last login timestamp
- `createdAt`, `updatedAt`: Timestamps

### SocialMediaAccount Model
- `userId`: Reference to User
- `platform`: Social media platform (twitter, facebook, instagram, linkedin)
- `accountName`: Display name for the account
- `accountId`: Platform-specific account ID
- `accessToken`: OAuth access token
- `refreshToken`: OAuth refresh token (if available)
- `tokenExpiresAt`: Token expiration date
- Platform-specific fields (pageId, instagramAccountId, etc.)
- `isActive`: Account status
- `lastUsed`: Last usage timestamp

## API Endpoints

### Authentication
- `POST /auth/register` - Register new user
- `POST /auth/login` - User login
- `GET /auth/profile` - Get user profile

### Social Media Accounts
- `POST /auth/social-accounts` - Save social media account
- `GET /auth/social-accounts` - Get user's social media accounts
- `DELETE /auth/social-accounts/:accountId` - Delete social media account

## Security Features

1. **Password Hashing**: Passwords are hashed using bcrypt
2. **JWT Authentication**: Secure token-based authentication
3. **Input Validation**: All inputs are validated
4. **Error Handling**: Comprehensive error handling
5. **Token Expiration**: JWT tokens expire after 7 days

## Troubleshooting

### MongoDB Connection Issues
1. Make sure MongoDB is running: `mongod`
2. Check if port 27017 is available
3. Verify the connection string in .env

### Authentication Issues
1. Check JWT_SECRET in .env
2. Verify token format in Authorization header
3. Check if user exists in database

### Social Media Account Issues
1. Verify OAuth credentials in .env
2. Check if account already exists for the user
3. Ensure proper platform enum values

## Next Steps

1. Update your frontend to use the new authentication system
2. Integrate social media OAuth flows with database storage
3. Add user management features
4. Implement account recovery and password reset
5. Add admin panel for user management
