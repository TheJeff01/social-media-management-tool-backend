const express = require('express');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const router = express.Router();
const cloudinary = require('cloudinary').v2;
const jwt = require('jsonwebtoken');
const SocialMediaAccount = require('../models/SocialMediaAccount');

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

// --------------------
// CLOUDINARY CONFIGURATION
// --------------------
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// --------------------
// HELPER: Convert uploaded files to Cloudinary URLs
// --------------------
async function convertFilesToCloudinaryUrls(imageFiles, videoFiles) {
  const mediaUrls = [];
  
  // Process image files
  for (let i = 0; i < imageFiles.length; i++) {
    const file = imageFiles[i];
    
    try {
      console.log(`☁️ Uploading image ${file.originalname} to Cloudinary...`);
      
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          {
            resource_type: 'image',
            folder: 'social-media-posts/images',
            format: 'jpg',
            quality: 'auto:good',
            fetch_format: 'auto',
            transformation: [
              { width: 1080, height: 1080, crop: 'limit' },
              { quality: 'auto:good' }
            ]
          },
          (error, result) => {
            if (error) {
              console.error('❌ Cloudinary image upload error:', error);
              reject(error);
            } else {
              resolve(result);
            }
          }
        ).end(file.buffer);
      });
      
      mediaUrls.push({
        url: result.secure_url,
        type: 'image',
        public_id: result.public_id
      });
      console.log(`✅ Image upload successful: ${result.secure_url}`);
      console.log(`📊 Image details: ${result.width}x${result.height}, ${result.format}, ${result.bytes} bytes`);
      
    } catch (error) {
      console.error(`❌ Cloudinary image upload failed for ${file.originalname}:`, error.message);
    }
  }
  
  // Process video files
  for (let i = 0; i < videoFiles.length; i++) {
    const file = videoFiles[i];
    
    try {
      console.log(`🎬 Uploading video ${file.originalname} to Cloudinary...`);
      
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          {
            resource_type: 'video',
            folder: 'social-media-posts/videos',
            quality: 'auto:good',
            format: 'mp4',
            transformation: [
              { width: 1920, height: 1080, crop: 'limit', quality: 'auto:good' },
              { video_codec: 'h264', audio_codec: 'aac' }
            ]
          },
          (error, result) => {
            if (error) {
              console.error('❌ Cloudinary video upload error:', error);
              reject(error);
            } else {
              resolve(result);
            }
          }
        ).end(file.buffer);
      });
      
      mediaUrls.push({
        url: result.secure_url,
        type: 'video',
        public_id: result.public_id,
        duration: result.duration
      });
      console.log(`✅ Video upload successful: ${result.secure_url}`);
      console.log(`📊 Video details: ${result.width}x${result.height}, ${result.duration}s, ${result.bytes} bytes`);
      
    } catch (error) {
      console.error(`❌ Cloudinary video upload failed for ${file.originalname}:`, error.message);
    }
  }
  
  return mediaUrls;
}

// --------------------
// HELPER: Create HTTP Errors
// --------------------
function httpError(message, status, retryAfter) {
  const err = new Error(message || 'Request failed');
  if (status) err.status = status;
  if (retryAfter) err.retryAfter = retryAfter;
  return err;
}

// --------------------
// MULTER CONFIGURATION (Updated for video support)
// --------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 5 * 1024 * 1024 * 1024, // 5GB max file size
    files: 20 // Max 20 files total
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image and video files are allowed'), false);
    }
  }
});

// --------------------
// NEW ROUTE: Get user's connected accounts for posting
// --------------------
router.get('/accounts', authenticateUser, async (req, res) => {
  try {
    const accounts = await SocialMediaAccount.find({ 
      userId: req.userId,
      isActive: true 
    }).sort({ lastUsed: -1 });

    const formattedAccounts = accounts.map(account => ({
      id: account._id,
      platform: account.platform,
      accountName: account.accountName,
      accountId: account.accountId,
      // Don't include access tokens in the response for security
      hasAccessToken: !!account.accessToken,
      pageId: account.pageId,
      pageName: account.pageName,
      instagramAccountId: account.instagramAccountId,
      linkedinUserId: account.linkedinUserId,
      lastUsed: account.lastUsed
    }));

    res.json({
      success: true,
      accounts: formattedAccounts
    });

  } catch (error) {
    console.error('Error fetching user accounts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch connected accounts'
    });
  }
});

// --------------------
// LINKEDIN HELPERS - Updated for video
// --------------------
async function uploadLinkedInMedia(mediaFile, mediaUrl, accessToken, userId, isVideo = false) {
  console.log(`💼 Starting LinkedIn ${isVideo ? 'video' : 'image'} upload...`);
  
  let mediaBuffer, contentType, filename;

  if (mediaFile) {
    mediaBuffer = mediaFile.buffer;
    contentType = mediaFile.mimetype;
    filename = mediaFile.originalname || `${isVideo ? 'video' : 'image'}.${isVideo ? 'mp4' : 'jpg'}`;
    console.log(`📁 Using uploaded file for LinkedIn:`, { size: mediaBuffer.length, type: contentType, filename });
  } else if (mediaUrl && mediaUrl.trim()) {
    console.log(`🔗 Fetching ${isVideo ? 'video' : 'image'} from URL for LinkedIn:`, mediaUrl);
    try {
      const mediaResponse = await axios.get(mediaUrl, { 
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: 5 * 1024 * 1024 * 1024, // 5GB for videos
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SocialMediaBot/1.0)' }
      });
      mediaBuffer = Buffer.from(mediaResponse.data);
      contentType = mediaResponse.headers['content-type'] || (isVideo ? 'video/mp4' : 'image/jpeg');
      const urlParts = mediaUrl.split('/');
      filename = urlParts[urlParts.length - 1] || `${isVideo ? 'video' : 'image'}.${isVideo ? 'mp4' : 'jpg'}`;
      console.log(`✅ ${isVideo ? 'Video' : 'Image'} fetched for LinkedIn:`, { size: mediaBuffer.length, type: contentType, filename });
    } catch (fetchError) {
      console.error(`❌ Failed to fetch ${isVideo ? 'video' : 'image'} for LinkedIn:`, fetchError.message);
      throw new Error(`Failed to fetch ${isVideo ? 'video' : 'image'}: ${fetchError.message}`);
    }
  } else {
    throw new Error(`No ${isVideo ? 'video' : 'image'} file or URL provided for LinkedIn`);
  }

  if (!mediaBuffer || mediaBuffer.length === 0) {
    throw new Error(`Empty ${isVideo ? 'video' : 'image'} buffer for LinkedIn`);
  }

  try {
    const recipe = isVideo ? 'urn:li:digitalmediaRecipe:feedshare-video' : 'urn:li:digitalmediaRecipe:feedshare-image';
    
    const initializePayload = {
      registerUploadRequest: {
        recipes: [recipe],
        owner: `urn:li:person:${userId}`,
        serviceRelationships: [
          { relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }
        ]
      }
    };

    const initResponse = await axios.post(
      'https://api.linkedin.com/v2/assets?action=registerUpload',
      initializePayload,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0'
        },
        timeout: 30000
      }
    );

    if (!initResponse.data?.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']) {
      throw new Error(`LinkedIn ${isVideo ? 'video' : 'image'} upload initialization failed - no upload URL received`);
    }

    const uploadUrl = initResponse.data.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
    const asset = initResponse.data.value.asset;

    console.log(`✅ LinkedIn ${isVideo ? 'video' : 'image'} upload initialized:`, { asset, uploadUrl: uploadUrl.substring(0, 50) + '...' });
    
    const uploadResponse = await axios.put(
      uploadUrl,
      mediaBuffer,
      {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: isVideo ? 300000 : 60000, // 5 minutes for videos, 1 minute for images
        maxContentLength: 5 * 1024 * 1024 * 1024
      }
    );

    if (uploadResponse.status !== 201 && uploadResponse.status !== 200) {
      throw new Error(`LinkedIn ${isVideo ? 'video' : 'image'} binary upload failed with status: ${uploadResponse.status}`);
    }

    console.log(`✅ LinkedIn ${isVideo ? 'video' : 'image'} binary upload successful`);
    return asset;

  } catch (uploadError) {
    console.error(`❌ LinkedIn ${isVideo ? 'video' : 'image'} upload failed:`, {
      message: uploadError.message,
      status: uploadError.response?.status,
      statusText: uploadError.response?.statusText,
      data: uploadError.response?.data
    });

    const errorMessage = uploadError.response?.data?.message || 
                        uploadError.response?.data?.error || 
                        uploadError.message || 
                        `LinkedIn ${isVideo ? 'video' : 'image'} upload failed`;
    const retryAfter = uploadError.response?.headers?.['retry-after'];
    throw httpError(`LinkedIn ${isVideo ? 'video' : 'image'} upload failed: ${errorMessage}`, uploadError.response?.status || 500, retryAfter);
  }
}

async function postToLinkedIn({ content, accessToken, userId, imageFiles = [], videoFiles = [], mediaUrls = [] }) {
  console.log('💼 Starting LinkedIn post:', {
    hasContent: !!content,
    imageFileCount: imageFiles.length,
    videoFileCount: videoFiles.length,
    mediaUrlCount: mediaUrls.length,
    contentLength: content?.length || 0
  });

  if (!accessToken || !userId) {
    throw new Error('LinkedIn access token and user ID are required');
  }

  if (!content && imageFiles.length === 0 && videoFiles.length === 0 && mediaUrls.length === 0) {
    throw new Error('Either content or media are required for LinkedIn posts');
  }

  let mediaAssets = [];
  
  // Upload image files
  for (let i = 0; i < imageFiles.length; i++) {
    try {
      const asset = await uploadLinkedInMedia(imageFiles[i], null, accessToken, userId, false);
      mediaAssets.push(asset);
      console.log(`📎 LinkedIn image file ${i + 1} uploaded successfully, asset:`, asset);
    } catch (mediaError) {
      console.warn(`⚠️ LinkedIn image file ${i + 1} upload failed:`, mediaError.message);
    }
  }

  // Upload video files
  for (let i = 0; i < videoFiles.length; i++) {
    try {
      const asset = await uploadLinkedInMedia(videoFiles[i], null, accessToken, userId, true);
      mediaAssets.push(asset);
      console.log(`📎 LinkedIn video file ${i + 1} uploaded successfully, asset:`, asset);
    } catch (mediaError) {
      console.warn(`⚠️ LinkedIn video file ${i + 1} upload failed:`, mediaError.message);
    }
  }

  // Upload media from URLs
  for (let i = 0; i < mediaUrls.length; i++) {
    try {
      const isVideoUrl = /\.(mp4|mov|avi|wmv|flv|webm|m4v)(\?|$)/i.test(mediaUrls[i]);
      const asset = await uploadLinkedInMedia(null, mediaUrls[i], accessToken, userId, isVideoUrl);
      mediaAssets.push(asset);
      console.log(`📎 LinkedIn URL ${i + 1} uploaded successfully, asset:`, asset);
    } catch (mediaError) {
      console.warn(`⚠️ LinkedIn URL ${i + 1} upload failed:`, mediaError.message);
    }
  }

  const postPayload = {
    author: `urn:li:person:${userId}`,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: {
          text: content || ' '
        },
        shareMediaCategory: mediaAssets.length > 0 ? (videoFiles.length > 0 || mediaUrls.some(url => /\.(mp4|mov|avi|wmv|flv|webm|m4v)(\?|$)/i.test(url)) ? "VIDEO" : "IMAGE") : "NONE"
      }
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
    }
  };

  if (mediaAssets.length > 0) {
    postPayload.specificContent["com.linkedin.ugc.ShareContent"].media = mediaAssets.map((asset, index) => ({
      status: "READY",
      description: { text: `Media ${index + 1}` },
      media: asset,
      title: { text: `Media ${index + 1}` }
    }));
  }

  console.log('📝 Posting to LinkedIn with payload:', {
    hasMedia: mediaAssets.length > 0,
    mediaCount: mediaAssets.length,
    shareMediaCategory: postPayload.specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory
  });

  try {
    const response = await axios.post(
      'https://api.linkedin.com/v2/ugcPosts',
      postPayload,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0'
        },
        timeout: 30000
      }
    );

    console.log('📨 LinkedIn post response:', {
      status: response.status,
      postId: response.data?.id
    });

    if (response.data?.id) {
      return {
        success: true,
        platform: 'LinkedIn',
        postId: response.data.id,
        data: response.data,
        message: `LinkedIn post with ${mediaAssets.length} media file${mediaAssets.length !== 1 ? 's' : ''} published successfully!`
      };
    } else {
      throw new Error('Invalid response from LinkedIn API - no post ID returned');
    }

  } catch (postError) {
    console.error('❌ LinkedIn post failed:', {
      message: postError.message,
      status: postError.response?.status,
      statusText: postError.response?.statusText,
      data: postError.response?.data
    });

    let errorMessage = 'Failed to post to LinkedIn';
    if (postError.response?.data?.message) errorMessage = postError.response.data.message;
    else if (postError.response?.data?.error) errorMessage = postError.response.data.error;
    else if (postError.message) errorMessage = postError.message;

    if (postError.response?.status === 401) {
      errorMessage = 'LinkedIn authentication failed. Please reconnect your account.';
    } else if (postError.response?.status === 403) {
      errorMessage = 'Permission denied. Check your LinkedIn app permissions for posting.';
    } else if (postError.response?.status === 429) {
      errorMessage = 'LinkedIn rate limit exceeded. Please try again later.';
    }
    const retryAfter = postError.response?.headers?.['retry-after'];
    throw httpError(errorMessage, postError.response?.status || 500, retryAfter);
  }
}

// --------------------
// TWITTER HELPERS - Updated for video
// --------------------
async function uploadTwitterMedia(mediaFile, mediaUrl, accessToken, isVideo = false) {
  console.log(`🐦 Starting Twitter ${isVideo ? 'video' : 'image'} upload...`);
  
  let mediaBuffer, contentType, filename;

  if (mediaFile) {
    mediaBuffer = mediaFile.buffer;
    contentType = mediaFile.mimetype;
    filename = mediaFile.originalname || `${isVideo ? 'video' : 'image'}.${isVideo ? 'mp4' : 'jpg'}`;
  } else if (mediaUrl && mediaUrl.trim()) {
    const mediaResponse = await axios.get(mediaUrl, { 
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: 512 * 1024 * 1024 // 512MB max for Twitter
    });
    
    mediaBuffer = Buffer.from(mediaResponse.data);
    contentType = mediaResponse.headers['content-type'] || (isVideo ? 'video/mp4' : 'image/jpeg');
    const urlParts = mediaUrl.split('/');
    filename = urlParts[urlParts.length - 1] || `${isVideo ? 'video' : 'image'}.${isVideo ? 'mp4' : 'jpg'}`;
  }

  if (!mediaBuffer) throw new Error(`No ${isVideo ? 'video' : 'image'} buffer available`);

  const formData = new FormData();
  formData.append('media', mediaBuffer, { filename, contentType });
  formData.append('media_category', isVideo ? 'tweet_video' : 'tweet_image');

  const uploadResponse = await axios.post(
    'https://upload.twitter.com/1.1/media/upload.json',
    formData,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        ...formData.getHeaders()
      },
      timeout: isVideo ? 300000 : 30000 // 5 minutes for videos, 30 seconds for images
    }
  );

  if (uploadResponse.data && uploadResponse.data.media_id_string) {
    return uploadResponse.data.media_id_string;
  } else {
    throw new Error(`Failed to get media ID from Twitter for ${isVideo ? 'video' : 'image'}`);
  }
}

async function postToTwitter({ content, accessToken, imageFiles = [], videoFiles = [], mediaUrls = [] }) {
  if (!accessToken) throw httpError('Twitter access token required', 400);
  if (!content && imageFiles.length === 0 && videoFiles.length === 0 && mediaUrls.length === 0) {
    throw httpError('Content or media required', 400);
  }

  try {
  let mediaIds = [];
    const maxMedia = 4; // Twitter limit
    let processedCount = 0;

    // Process image files (up to 4 total)
    for (let i = 0; i < Math.min(imageFiles.length, maxMedia - processedCount); i++) {
      try {
        const mediaId = await uploadTwitterMedia(imageFiles[i], null, accessToken, false);
        mediaIds.push(mediaId);
        processedCount++;
      } catch (err) {
        console.warn(`⚠️ Twitter image file ${i + 1} upload failed:`, err.message);
      }
    }

    // Process video files (Twitter supports 1 video OR up to 4 images)
    for (let i = 0; i < Math.min(videoFiles.length, 1); i++) {
      if (processedCount === 0) { // Only add video if no images were added
        try {
          const mediaId = await uploadTwitterMedia(videoFiles[i], null, accessToken, true);
      mediaIds.push(mediaId);
          processedCount++;
          break; // Twitter only supports 1 video per tweet
    } catch (err) {
          console.warn(`⚠️ Twitter video file ${i + 1} upload failed:`, err.message);
        }
      }
    }

    // Process URLs (remaining slots)
    const remainingSlots = maxMedia - processedCount;
    for (let i = 0; i < Math.min(mediaUrls.length, remainingSlots); i++) {
      try {
        const isVideoUrl = /\.(mp4|mov|avi|wmv|flv|webm|m4v)(\?|$)/i.test(mediaUrls[i]);
        if (isVideoUrl && mediaIds.length > 0) continue; // Skip if already have media (Twitter: 1 video OR multiple images)
        
        const mediaId = await uploadTwitterMedia(null, mediaUrls[i], accessToken, isVideoUrl);
      mediaIds.push(mediaId);
        if (isVideoUrl) break; // Only one video allowed
    } catch (err) {
      console.warn(`⚠️ Twitter URL ${i + 1} upload failed:`, err.message);
    }
  }

  const tweetPayload = { text: content || ' ' };
  if (mediaIds.length > 0) {
    tweetPayload.media = { media_ids: mediaIds };
  }

  const response = await axios.post('https://api.twitter.com/2/tweets', tweetPayload, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  if (response.data?.data) {
    return {
      success: true,
      platform: 'Twitter',
      postId: response.data.data.id,
      data: response.data.data,
        message: `Tweet with ${mediaIds.length} media file${mediaIds.length !== 1 ? 's' : ''} posted successfully!`
      };
    }
    throw httpError('Invalid response from Twitter API', 502);

  } catch (e) {
    const status = e.response?.status || e.status || 500;
    const retryAfter = e.response?.headers?.['retry-after'] || e.retryAfter;
    let message = 'Failed to post to Twitter';
    if (e.response?.data?.error) message = e.response.data.error;
    else if (e.message) message = e.message;
    if (status === 429 && !/rate limit/i.test(message)) {
      message = 'Twitter rate limit exceeded. Please try again later.';
    }
    throw httpError(message, status, retryAfter);
  }
}

// --------------------
// FACEBOOK HELPERS - Updated for video
// --------------------
async function postToFacebook({ content, pageId, pageToken, imageFiles = [], videoFiles = [], mediaUrls = [] }) {
  if (!pageId || !pageToken) throw httpError('Facebook page ID and token required', 400);
  if (!content && imageFiles.length === 0 && videoFiles.length === 0 && mediaUrls.length === 0) {
    throw httpError('Content or media required', 400);
  }

  try {
    const allImageFiles = imageFiles;
    const allVideoFiles = videoFiles;
    const imageUrls = mediaUrls.filter(url => !/\.(mp4|mov|avi|wmv|flv|webm|m4v)(\?|$)/i.test(url));
    const videoUrls = mediaUrls.filter(url => /\.(mp4|mov|avi|wmv|flv|webm|m4v)(\?|$)/i.test(url));
    
    // Handle single video post
    if (allVideoFiles.length === 1 && allImageFiles.length === 0 && imageUrls.length === 0 && videoUrls.length === 0) {
      const formData = new FormData();
      formData.append('source', allVideoFiles[0].buffer, {
        filename: allVideoFiles[0].originalname,
        contentType: allVideoFiles[0].mimetype
      });
      formData.append('description', content || '');
      formData.append('access_token', pageToken);

      const response = await axios.post(`https://graph.facebook.com/${pageId}/videos`, formData, {
        headers: formData.getHeaders(),
        timeout: 300000 // 5 minutes for video upload
      });

      if (response.data?.id) {
        return {
          success: true,
          platform: 'Facebook',
          postId: response.data.id,
          data: response.data,
          message: 'Facebook video post published successfully!'
        };
      }
    }
    
    // Handle single video URL post
    if (videoUrls.length === 1 && allVideoFiles.length === 0 && allImageFiles.length === 0 && imageUrls.length === 0) {
      const response = await axios.post(`https://graph.facebook.com/${pageId}/videos`, {
        file_url: videoUrls[0],
        description: content || '',
        access_token: pageToken
      });

      if (response.data?.id) {
        return {
          success: true,
          platform: 'Facebook',
          postId: response.data.id,
          data: response.data,
          message: 'Facebook video post published successfully!'
        };
      }
    }

    // Handle text-only post
    if (allImageFiles.length === 0 && allVideoFiles.length === 0 && imageUrls.length === 0 && videoUrls.length === 0) {
    const response = await axios.post(`https://graph.facebook.com/${pageId}/feed`, {
      message: content,
      access_token: pageToken
    });

    if (response.data?.id) {
      return {
        success: true,
        platform: 'Facebook',
        postId: response.data.id,
        data: response.data,
        message: 'Facebook post published successfully!'
      };
    }
    }
    
    // Handle single image post
    else if (allImageFiles.length === 1 && allVideoFiles.length === 0 && imageUrls.length === 0 && videoUrls.length === 0) {
      const formData = new FormData();
      formData.append('source', allImageFiles[0].buffer, {
        filename: allImageFiles[0].originalname,
        contentType: allImageFiles[0].mimetype
      });
      formData.append('caption', content || '');
      formData.append('access_token', pageToken);

      const response = await axios.post(`https://graph.facebook.com/${pageId}/photos`, formData, {
        headers: formData.getHeaders()
      });

      if (response.data?.id) {
        return {
          success: true,
          platform: 'Facebook',
          postId: response.data.id,
          data: response.data,
          message: 'Facebook image post published successfully!'
        };
      }
    }
    
    // Handle single image URL post
    else if (imageUrls.length === 1 && allImageFiles.length === 0 && allVideoFiles.length === 0 && videoUrls.length === 0) {
      const response = await axios.post(`https://graph.facebook.com/${pageId}/photos`, {
        url: imageUrls[0],
        caption: content || '',
        access_token: pageToken
      });

    if (response.data?.id) {
      return {
        success: true,
        platform: 'Facebook',
        postId: response.data.id,
        data: response.data,
          message: 'Facebook image post published successfully!'
        };
      }
    }
    
    // Handle multiple images (album)
    else if (allImageFiles.length > 1 || imageUrls.length > 1) {
    const photoIds = [];
    
      // Upload image files
      for (let i = 0; i < allImageFiles.length; i++) {
      try {
        const formData = new FormData();
          formData.append('source', allImageFiles[i].buffer, {
            filename: allImageFiles[i].originalname,
            contentType: allImageFiles[i].mimetype
          });
          formData.append('published', 'false');
        formData.append('access_token', pageToken);

        const uploadResponse = await axios.post(
          `https://graph.facebook.com/${pageId}/photos`,
          formData,
          { headers: formData.getHeaders() }
        );

        if (uploadResponse.data?.id) {
          photoIds.push(uploadResponse.data.id);
        }
      } catch (err) {
          console.warn(`⚠️ Facebook image file ${i + 1} upload failed:`, err.message);
      }
    }

      // Upload image URLs
    for (let i = 0; i < imageUrls.length; i++) {
      try {
        const uploadResponse = await axios.post(`https://graph.facebook.com/${pageId}/photos`, {
          url: imageUrls[i],
          published: false,
          access_token: pageToken
        });

        if (uploadResponse.data?.id) {
          photoIds.push(uploadResponse.data.id);
        }
      } catch (err) {
          console.warn(`⚠️ Facebook image URL ${i + 1} upload failed:`, err.message);
      }
    }

    if (photoIds.length > 0) {
      const albumResponse = await axios.post(`https://graph.facebook.com/${pageId}/feed`, {
        message: content || '',
        attached_media: photoIds.map(id => ({ media_fbid: id })),
        access_token: pageToken
      });

      if (albumResponse.data?.id) {
        return {
          success: true,
          platform: 'Facebook',
          postId: albumResponse.data.id,
          data: albumResponse.data,
            message: `Facebook album with ${photoIds.length} images published successfully!`
        };
      }
    }
  }

    throw httpError('Invalid response from Facebook API', 502);
  } catch (e) {
    const status = e.response?.status || e.status || 500;
    const retryAfter = e.response?.headers?.['retry-after'] || e.retryAfter;
    let message = 'Failed to post to Facebook';
    if (e.response?.data?.error?.message) message = e.response.data.error.message;
    else if (e.message) message = e.message;
    if (status === 429 && !/rate limit/i.test(message)) {
      message = 'Facebook rate limit exceeded. Please try again later.';
    }
    throw httpError(message, status, retryAfter);
  }
}

// --------------------
// INSTAGRAM HELPERS - Updated for video
// --------------------
async function postToInstagram({ content, pageAccessToken, instagramAccountId, mediaUrls = [] }) {
  console.log('📷 Starting Instagram Graph API post:', {
    hasContent: !!content,
    mediaUrlCount: mediaUrls.length,
    hasPageToken: !!pageAccessToken,
    hasIgAccountId: !!instagramAccountId
  });

  if (!pageAccessToken || !instagramAccountId) {
    throw new Error('Instagram page access token and account ID are required');
  }

  if (!content && mediaUrls.length === 0) {
    throw new Error('Content or media are required for Instagram posts');
  }

  try {
    if (mediaUrls.length === 0) {
      throw new Error('Instagram requires at least one image or video. Text-only posts are not supported.');
    }

    console.log(`🔍 Validating ${mediaUrls.length} media URLs...`);
    const validUrls = [];
    const videoUrls = [];
    const imageUrls = [];
    
    for (const url of mediaUrls) {
      try {
        const response = await axios.head(url, { 
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; InstagramBot/1.0)'
          }
        });
        
        const contentType = response.headers['content-type'];
        if (contentType && contentType.startsWith('image/')) {
          imageUrls.push(url);
          validUrls.push({ url, type: 'image' });
        } else if (contentType && contentType.startsWith('video/')) {
          videoUrls.push(url);
          validUrls.push({ url, type: 'video' });
        } else {
          console.warn(`⚠️ URL is not valid media: ${url} (${contentType})`);
        }
        
      } catch (urlError) {
        console.error(`❌ URL validation failed: ${url}`, { message: urlError.message, status: urlError.response?.status });
      }
    }

    if (validUrls.length === 0) {
      throw new Error('No valid, accessible media URLs found. All media must be publicly accessible.');
    }

    console.log(`📷 Using ${validUrls.length}/${mediaUrls.length} validated URLs for Instagram post (${imageUrls.length} images, ${videoUrls.length} videos)`);

    // Instagram supports either 1 video OR 1-10 images, but not mixed content
    if (videoUrls.length > 0 && imageUrls.length > 0) {
      throw new Error('Instagram does not support mixing images and videos in the same post. Please post them separately.');
    }

    if (videoUrls.length > 1) {
      throw new Error('Instagram supports only 1 video per post.');
    }

    // Validate video requirements for Reels
    if (videoUrls.length === 1) {
      console.log('📷 Validating video requirements for Instagram Reels...');
      // Instagram Reels requirements:
      // - Aspect ratio: 9:16 (portrait)
      // - Duration: 3-90 seconds
      // - File size: Up to 4GB
      // - Format: MP4
      try {
        const videoUrl = videoUrls[0];
        const response = await axios.head(videoUrl, { 
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; InstagramBot/1.0)'
          }
        });
        
        const contentType = response.headers['content-type'];
        if (!contentType || !contentType.startsWith('video/')) {
          throw new Error('Invalid video format. Instagram Reels require MP4 video files.');
        }
        
        console.log('✅ Video format validated for Instagram Reels');
      } catch (validationError) {
        console.warn('⚠️ Could not validate video format:', validationError.message);
      }
    }

    if (validUrls.length === 1) {
      console.log(`📷 Creating single ${validUrls[0].type} Instagram post...`);
      const mediaItem = validUrls[0];
      
      const containerPayload = {
        [mediaItem.type === 'video' ? 'video_url' : 'image_url']: mediaItem.url,
          caption: content || '',
        media_type: mediaItem.type === 'video' ? 'REELS' : 'IMAGE',
          access_token: pageAccessToken
      };

      const containerResponse = await axios.post(
        `https://graph.facebook.com/v18.0/${instagramAccountId}/media`,
        containerPayload,
        { timeout: 60000 }
      );

      if (!containerResponse.data?.id) {
        throw new Error(`Failed to create Instagram media container: ${containerResponse.data?.error?.message || 'Unknown error'}`);
      }

      const containerId = containerResponse.data.id;
      console.log('✅ Instagram media container created:', containerId);

      // Wait for media processing and check status
      let isReady = false;
      let attempts = 0;
      const maxAttempts = 30; // 5 minutes total (30 * 10 seconds)
      
      while (!isReady && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds between checks
        attempts++;
        
        try {
          console.log(`📊 Checking media status (attempt ${attempts}/${maxAttempts})...`);
          const statusResponse = await axios.get(
            `https://graph.facebook.com/v18.0/${containerId}?fields=status_code,status&access_token=${pageAccessToken}`,
            { timeout: 10000 }
          );
          
          if (statusResponse.data.status_code === 'FINISHED') {
            isReady = true;
            console.log('✅ Media processing completed successfully');
          } else if (statusResponse.data.status_code === 'ERROR') {
            throw new Error(`Media processing failed: ${statusResponse.data.status || 'Unknown error'}`);
          } else {
            console.log(`⏳ Media still processing: ${statusResponse.data.status_code} - ${statusResponse.data.status || 'Processing...'}`);
          }
        } catch (statusError) {
          console.warn(`⚠️ Could not check media status (attempt ${attempts}):`, statusError.message);
          if (attempts === maxAttempts) {
            console.warn('⚠️ Proceeding with publish attempt despite status check failure');
            isReady = true; // Try to publish anyway
          }
        }
      }
      
      if (!isReady) {
        throw new Error('Media processing timed out. Please try again with a smaller video file.');
      }

      const publishPayload = {
          creation_id: containerId,
          access_token: pageAccessToken
      };
      
      const publishResponse = await axios.post(
        `https://graph.facebook.com/v18.0/${instagramAccountId}/media_publish`,
        publishPayload,
        { timeout: 60000 }
      );

      if (publishResponse.data?.id) {
        return {
          success: true,
          platform: 'Instagram',
          postId: publishResponse.data.id,
          data: publishResponse.data,
          message: `Instagram ${mediaItem.type} post published successfully!`
        };
      } else {
        throw new Error(`Failed to publish Instagram post: ${publishResponse.data?.error?.message || 'Unknown error'}`);
      }

    } else if (validUrls.length <= 10 && videoUrls.length === 0) {
      // Multiple images (carousel)
      console.log(`📷 Creating Instagram carousel post with ${validUrls.length} images...`);
      const containerIds = [];
      
      for (let i = 0; i < validUrls.length; i++) {
        try {
          console.log(`📤 Creating container for image ${i + 1}/${validUrls.length}...`);
          
          const containerResponse = await axios.post(
            `https://graph.facebook.com/v18.0/${instagramAccountId}/media`,
            {
              image_url: validUrls[i].url,
              is_carousel_item: true,
              access_token: pageAccessToken
            },
            { timeout: 60000 }
          );

          if (containerResponse.data?.id) {
            containerIds.push(containerResponse.data.id);
            console.log(`✅ Image ${i + 1} container created:`, containerResponse.data.id);
          }
          
          if (i < validUrls.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
        } catch (mediaError) {
          console.error(`❌ Image ${i + 1} container creation failed:`, mediaError.message);
        }
      }

      if (containerIds.length === 0) {
        throw new Error('Failed to create any Instagram media containers');
      }

      await new Promise(resolve => setTimeout(resolve, 5000));

      const carouselResponse = await axios.post(
        `https://graph.facebook.com/v18.0/${instagramAccountId}/media`,
        {
          media_type: 'CAROUSEL',
          children: containerIds.join(','),
          caption: content || '',
          access_token: pageAccessToken
        },
        { timeout: 60000 }
      );

      if (!carouselResponse.data?.id) {
        throw new Error(`Failed to create Instagram carousel container: ${carouselResponse.data?.error?.message || 'Unknown error'}`);
      }

      const carouselId = carouselResponse.data.id;
      console.log('✅ Carousel container created:', carouselId);

      await new Promise(resolve => setTimeout(resolve, 3000));

      const publishResponse = await axios.post(
        `https://graph.facebook.com/v18.0/${instagramAccountId}/media_publish`,
        {
          creation_id: carouselId,
          access_token: pageAccessToken
        },
        { timeout: 60000 }
      );

      if (publishResponse.data?.id) {
        return {
          success: true,
          platform: 'Instagram',
          postId: publishResponse.data.id,
          data: publishResponse.data,
          message: `Instagram carousel with ${containerIds.length} images published successfully!`
        };
      } else {
        throw new Error(`Failed to publish Instagram carousel: ${publishResponse.data?.error?.message || 'Unknown error'}`);
      }
    } else {
      throw new Error('Instagram supports maximum 10 images in a carousel, or 1 video per post');
    }

  } catch (postError) {
    console.error('❌ Instagram post failed:', {
      message: postError.message,
      status: postError.response?.status,
      statusText: postError.response?.statusText,
      data: postError.response?.data
    });

    let errorMessage = 'Failed to post to Instagram';
    if (postError.response?.data?.error?.message) {
      errorMessage = postError.response.data.error.message;
    } else if (postError.response?.data?.error?.error_user_msg) {
      errorMessage = postError.response.data.error.error_user_msg;
    } else if (postError.response?.status === 400) {
      errorMessage = 'Bad request. Check that media files are valid and accessible, and Instagram account is properly connected.';
    } else if (postError.response?.status === 403) {
      errorMessage = 'Permission denied. Ensure Instagram account has posting permissions and is a Business/Creator account.';
    } else if (postError.response?.status === 429) {
      errorMessage = 'Instagram rate limit exceeded. Please try again later.';
    } else if (postError.message) {
      errorMessage = postError.message;
    }

    const retryAfter = postError.response?.headers?.['retry-after'];
    throw httpError(errorMessage, postError.response?.status || 500, retryAfter);
  }
}

// --------------------
// ROUTES
// --------------------

// Updated multer to handle both images and videos
const uploadFields = upload.fields([
  { name: 'images', maxCount: 10 },
  { name: 'videos', maxCount: 5 }
]);

// Updated Instagram route using stored credentials
router.post('/instagram/:accountId', uploadFields, authenticateUser, async (req, res) => {
  try {
    const { accountId } = req.params;
    const { content } = req.body;

    console.log('🔍 Looking for Instagram account:', {
      accountId: accountId,
      userId: req.userId,
      platform: 'instagram'
    });

    // Get the Instagram account from database
    const account = await SocialMediaAccount.findOne({
      _id: accountId,
      userId: req.userId,
      platform: 'instagram',
      isActive: true
    });

    console.log('🔍 Instagram account lookup result:', {
      found: !!account,
      accountId: account?._id,
      platform: account?.platform,
      hasAccessToken: !!account?.accessToken,
      hasInstagramAccountId: !!account?.instagramAccountId
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        platform: 'Instagram',
        error: 'Instagram account not found or not connected'
      });
    }

    if (!account.accessToken || !account.instagramAccountId) {
      return res.status(400).json({
        success: false,
        platform: 'Instagram',
        error: 'Instagram account not properly configured for posting'
      });
    }

    console.log('📥 Instagram posting route hit:', {
      accountId: accountId,
      hasContent: !!content,
      hasPageToken: !!account.accessToken,
      hasIgAccountId: !!account.instagramAccountId,
      imageFileCount: req.files?.images?.length || 0,
      videoFileCount: req.files?.videos?.length || 0,
      hasMediaUrls: !!req.body.mediaUrls,
      mediaUrlsValue: req.body.mediaUrls,
      bodyKeys: Object.keys(req.body),
      filesKeys: req.files ? Object.keys(req.files) : 'no files'
    });

    let allMediaUrls = [];
    
    // Upload files to Cloudinary
    if ((req.files?.images?.length > 0) || (req.files?.videos?.length > 0)) {
      console.log('☁️ Processing files through Cloudinary for Instagram...');
      try {
        const cloudinaryUrls = await convertFilesToCloudinaryUrls(req.files?.images || [], req.files?.videos || []);
        allMediaUrls.push(...cloudinaryUrls.map(item => item.url));
        console.log(`✅ ${cloudinaryUrls.length} files uploaded to Cloudinary`);
      } catch (cloudinaryError) {
        console.error('❌ Cloudinary upload failed:', cloudinaryError.message);
        console.log('⚠️ Cloudinary is not accessible. Please use media URLs instead of file uploads.');
        console.log('💡 Tip: Upload your media to a public URL and use that instead.');
        
        // Return a helpful error message
        return res.status(400).json({
          success: false,
          platform: 'Instagram',
          error: 'Cloudinary upload failed. Please use media URLs instead of file uploads. Upload your media to a public URL and paste the link.',
          details: cloudinaryError.message
        });
      }
    }

    // Add media URLs from request body
    if (req.body.mediaUrls) {
      const parsedMediaUrls = req.body.mediaUrls.split(',').map(url => url.trim()).filter(Boolean);
      allMediaUrls.push(...parsedMediaUrls);
      console.log(`📎 Added ${parsedMediaUrls.length} media URLs from request body`);
    }

    console.log(`📊 Total media count for Instagram: ${allMediaUrls.length} (files: ${req.files?.images?.length || 0} images, ${req.files?.videos?.length || 0} videos, URLs: ${req.body.mediaUrls ? req.body.mediaUrls.split(',').length : 0})`);

    if (allMediaUrls.length === 0) {
      return res.status(400).json({
        success: false,
        platform: 'Instagram',
        error: 'At least one image or video is required for Instagram posts'
      });
    }

    if (allMediaUrls.length > 10) {
      return res.status(400).json({
        success: false,
        platform: 'Instagram',
        error: 'Instagram supports maximum 10 images in a carousel or 1 video per post'
      });
    }

    console.log(`📷 Posting to Instagram with ${allMediaUrls.length} media files`);

    const result = await postToInstagram({
      content: content,
      pageAccessToken: account.accessToken,
      instagramAccountId: account.instagramAccountId,
      mediaUrls: allMediaUrls
    });

    // Update last used timestamp
    account.lastUsed = new Date();
    await account.save();

    res.json(result);
  } catch (error) {
    console.error('❌ Instagram route error:', error.message);
    const status = error.status || error.response?.status || 500;
    if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
    res.status(status).json({ 
      success: false, 
      platform: 'Instagram', 
      error: error.message 
    });
  }
});

// Updated Twitter route using stored credentials
router.post('/twitter/:accountId', uploadFields, authenticateUser, async (req, res) => {
  try {
    const { accountId } = req.params;
    const { content } = req.body;

    // Get the Twitter account from database
    const account = await SocialMediaAccount.findOne({
      _id: accountId,
      userId: req.userId,
      platform: 'twitter',
      isActive: true
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        platform: 'Twitter',
        error: 'Twitter account not found or not connected'
      });
    }

    if (!account.accessToken) {
      return res.status(400).json({
        success: false,
        platform: 'Twitter',
        error: 'Twitter account not properly configured for posting'
      });
    }

    const mediaUrls = [];
    
    // Upload files to Cloudinary
    if ((req.files?.images?.length > 0) || (req.files?.videos?.length > 0)) {
      console.log('☁️ Processing files through Cloudinary for Twitter...');
      const cloudinaryUrls = await convertFilesToCloudinaryUrls(req.files?.images || [], req.files?.videos || []);
      mediaUrls.push(...cloudinaryUrls.map(item => item.url));
      console.log(`✅ ${cloudinaryUrls.length} files uploaded to Cloudinary`);
    }

    const result = await postToTwitter({
      content: content,
      accessToken: account.accessToken,
      imageFiles: req.files?.images || [], 
      videoFiles: req.files?.videos || [],
      mediaUrls 
    });

    // Update last used timestamp
    account.lastUsed = new Date();
    await account.save();

    res.json(result);
  } catch (error) {
    console.error('❌ Twitter route error:', error.message);
    const status = error.status || error.response?.status || 500;
    if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
    res.status(status).json({ success: false, platform: 'Twitter', error: error.message });
  }
});

router.post('/facebook/:accountId', uploadFields, authenticateUser, async (req, res) => {
  try {
    const { accountId } = req.params;
    const { content } = req.body;

    // Get the Facebook account from database
    const account = await SocialMediaAccount.findOne({
      _id: accountId,
      userId: req.userId,
      platform: 'facebook',
      isActive: true
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        platform: 'Facebook',
        error: 'Facebook account not found or not connected'
      });
    }

    if (!account.accessToken || !account.pageId) {
      return res.status(400).json({
        success: false,
        platform: 'Facebook',
        error: 'Facebook account not properly configured for posting'
      });
    }

    const mediaUrls = [];
    
    // Upload files to Cloudinary
    if ((req.files?.images?.length > 0) || (req.files?.videos?.length > 0)) {
      console.log('☁️ Processing files through Cloudinary for Facebook...');
      const cloudinaryUrls = await convertFilesToCloudinaryUrls(req.files?.images || [], req.files?.videos || []);
      mediaUrls.push(...cloudinaryUrls.map(item => item.url));
      console.log(`✅ ${cloudinaryUrls.length} files uploaded to Cloudinary`);
    }

    const result = await postToFacebook({
      content: content,
      pageId: account.pageId,
      pageToken: account.accessToken,
      imageFiles: req.files?.images || [], 
      videoFiles: req.files?.videos || [],
      mediaUrls 
    });

    // Update last used timestamp
    account.lastUsed = new Date();
    await account.save();

    res.json(result);
  } catch (error) {
    console.error('❌ Facebook route error:', error.message);
    const status = error.status || error.response?.status || 500;
    if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
    res.status(status).json({ success: false, platform: 'Facebook', error: error.message });
  }
});

router.post('/linkedin/:accountId', uploadFields, authenticateUser, async (req, res) => {
  try {
    const { accountId } = req.params;
    const { content } = req.body;

    // Get the LinkedIn account from database
    const account = await SocialMediaAccount.findOne({
      _id: accountId,
      userId: req.userId,
      platform: 'linkedin',
      isActive: true
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        platform: 'LinkedIn',
        error: 'LinkedIn account not found or not connected'
      });
    }

    if (!account.accessToken || !account.linkedinUserId) {
      return res.status(400).json({
        success: false,
        platform: 'LinkedIn',
        error: 'LinkedIn account not properly configured for posting'
      });
    }

    const mediaUrls = [];
    
    // Upload files to Cloudinary
    if ((req.files?.images?.length > 0) || (req.files?.videos?.length > 0)) {
      console.log('☁️ Processing files through Cloudinary for LinkedIn...');
      const cloudinaryUrls = await convertFilesToCloudinaryUrls(req.files?.images || [], req.files?.videos || []);
      mediaUrls.push(...cloudinaryUrls.map(item => item.url));
      console.log(`✅ ${cloudinaryUrls.length} files uploaded to Cloudinary`);
    }

    const result = await postToLinkedIn({
      content: content,
      accessToken: account.accessToken,
      userId: account.linkedinUserId,
      imageFiles: req.files?.images || [], 
      videoFiles: req.files?.videos || [],
      mediaUrls 
    });

    // Update last used timestamp
    account.lastUsed = new Date();
    await account.save();

    res.json(result);
  } catch (error) {
    console.error('❌ LinkedIn route error:', error.message);
    const status = error.status || error.response?.status || 500;
    if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
    res.status(status).json({ success: false, platform: 'LinkedIn', error: error.message });
  }
});

// Updated multi-platform route using stored credentials
router.post('/multi', uploadFields, authenticateUser, async (req, res) => {
  const { content, platforms, mediaUrls } = req.body;
  const imageFiles = req.files?.images || [];
  const videoFiles = req.files?.videos || [];

  let parsedPlatforms;
  try {
    parsedPlatforms = typeof platforms === 'string' ? JSON.parse(platforms) : platforms;
  } catch (parseError) {
    return res.status(400).json({ success: false, error: 'Invalid JSON data in request', details: parseError.message });
  }

  if (!Array.isArray(parsedPlatforms) || parsedPlatforms.length === 0) {
    return res.status(400).json({ success: false, error: 'Platforms array required' });
  }

  const parsedMediaUrls = mediaUrls ? mediaUrls.split(',').map(url => url.trim()).filter(url => url) : [];

  const postPromises = parsedPlatforms.map(async (platform) => {
    try {
      // Get the account for this platform from database
      const account = await SocialMediaAccount.findOne({
        userId: req.userId,
        platform: platform.toLowerCase(),
        isActive: true
      });

      if (!account) {
        throw new Error(`${platform} account not found or not connected`);
      }

      let result;
      switch (platform.toLowerCase()) {
        case 'twitter':
          if (!account.accessToken) throw new Error('Twitter access token not found');
          result = await postToTwitter({
            content,
            accessToken: account.accessToken,
            imageFiles: imageFiles.slice(0, 4),
            videoFiles: videoFiles.slice(0, 1), // Twitter: max 1 video
            mediaUrls: parsedMediaUrls.slice(0, 4 - imageFiles.length - videoFiles.length)
          });
          break;
          
        case 'facebook':
          if (!account.accessToken || !account.pageId) throw new Error('Facebook credentials not found');
          result = await postToFacebook({
            content,
            pageId: account.pageId,
            pageToken: account.accessToken,
            imageFiles,
            videoFiles,
            mediaUrls: parsedMediaUrls
          });
          break;
          
        case 'instagram':
          if (!account.accessToken || !account.instagramAccountId) throw new Error('Instagram credentials not found');
          
          let allMediaUrls = [];
          if (imageFiles.length > 0 || videoFiles.length > 0) {
            const cloudinaryUrls = await convertFilesToCloudinaryUrls(imageFiles, videoFiles);
            allMediaUrls.push(...cloudinaryUrls.map(item => item.url));
          }
          allMediaUrls.push(...parsedMediaUrls.slice(0, 10 - allMediaUrls.length));
          
          result = await postToInstagram({
            content,
            pageAccessToken: account.accessToken,
            instagramAccountId: account.instagramAccountId,
            mediaUrls: allMediaUrls.slice(0, 10)
          });
          break;
          
        case 'linkedin':
          if (!account.accessToken || !account.linkedinUserId) throw new Error('LinkedIn credentials not found');
          result = await postToLinkedIn({
            content,
            accessToken: account.accessToken,
            userId: account.linkedinUserId,
            imageFiles: imageFiles.slice(0, 9),
            videoFiles: videoFiles.slice(0, 5),
            mediaUrls: parsedMediaUrls.slice(0, 9 - imageFiles.length - videoFiles.length)
          });
          break;
          
        default:
          throw new Error(`${platform} posting not implemented yet`);
      }

      // Update last used timestamp
      account.lastUsed = new Date();
      await account.save();

      return { platform, success: true, result };
    } catch (err) {
      return { platform, success: false, error: err.message };
    }
  });

  try {
    const results = await Promise.all(postPromises);
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    const totalMediaCount = imageFiles.length + videoFiles.length + parsedMediaUrls.length;

    res.json({
      success: successful.length > 0,
      totalPlatforms: parsedPlatforms.length,
      successful: successful.length,
      failed: failed.length,
      results,
      message: successful.length === parsedPlatforms.length
        ? `Successfully posted to all ${parsedPlatforms.length} platforms with ${totalMediaCount} media files!`
        : `Posted to ${successful.length} out of ${parsedPlatforms.length} platforms`
    });
  } catch (error) {
    console.error('❌ Multi-platform posting error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to process multi-platform posting',
      details: error.message
    });
  }
});

// ✅ Test Cloudinary connection
router.get('/test-cloudinary', async (req, res) => {
  try {
    const result = await cloudinary.api.ping();
    res.json({
      success: true,
      message: 'Cloudinary connection successful',
      status: result.status,
      timestamp: new Date().toISOString(),
      config: {
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME ? 'set' : 'missing',
        api_key: process.env.CLOUDINARY_API_KEY ? 'set' : 'missing',
        api_secret: process.env.CLOUDINARY_API_SECRET ? 'set' : 'missing'
      },
      supportedFormats: {
        images: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'],
        videos: ['mp4', 'mov', 'avi', 'wmv', 'flv', 'webm', 'm4v']
      }
    });
  } catch (error) {
    console.error('❌ Cloudinary test failed:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Cloudinary connection failed',
      details: error.message
    });
  }
});

// ✅ Get platform capabilities
router.get('/capabilities', (req, res) => {
  res.json({
    platforms: {
      twitter: {
        maxMedia: 4,
        supportsVideo: true,
        videoFormats: ['mp4', 'mov'],
        maxVideoSize: '512MB',
        notes: 'Max 1 video OR up to 4 images per tweet'
      },
      facebook: {
        maxMedia: 10,
        supportsVideo: true,
        videoFormats: ['mp4', 'mov', 'avi'],
        maxVideoSize: '4GB',
        notes: 'Supports single video or multiple images'
      },
      instagram: {
        maxMedia: 10,
        supportsVideo: true,
        videoFormats: ['mp4', 'mov'],
        maxVideoSize: '100MB',
        notes: 'Max 1 video OR up to 10 images per post (no mixing)'
      },
      linkedin: {
        maxMedia: 9,
        supportsVideo: true,
        videoFormats: ['mp4', 'mov', 'wmv', 'flv', 'avi'],
        maxVideoSize: '5GB',
        notes: 'Supports both images and videos'
      }
    }
  });
});

// --------------------
// HELPER FUNCTIONS FOR POSTING
// --------------------

// LinkedIn posting helper
async function postToLinkedIn({ content, accessToken, userId, imageFiles = [], videoFiles = [], mediaUrls = [] }) {
  console.log('💼 Starting LinkedIn post:', {
    hasContent: !!content,
    imageFileCount: imageFiles.length,
    videoFileCount: videoFiles.length,
    mediaUrlCount: mediaUrls.length,
    contentLength: content?.length || 0
  });

  if (!accessToken || !userId) {
    throw new Error('LinkedIn access token and user ID are required');
  }

  if (!content && imageFiles.length === 0 && videoFiles.length === 0 && mediaUrls.length === 0) {
    throw new Error('Either content or media are required for LinkedIn posts');
  }

  let mediaAssets = [];
  
  // Upload image files
  for (let i = 0; i < imageFiles.length; i++) {
    try {
      const asset = await uploadLinkedInMedia(imageFiles[i], null, accessToken, userId, false);
      mediaAssets.push(asset);
      console.log(`📎 LinkedIn image file ${i + 1} uploaded successfully, asset:`, asset);
    } catch (mediaError) {
      console.warn(`⚠️ LinkedIn image file ${i + 1} upload failed:`, mediaError.message);
    }
  }

  // Upload video files
  for (let i = 0; i < videoFiles.length; i++) {
    try {
      const asset = await uploadLinkedInMedia(videoFiles[i], null, accessToken, userId, true);
      mediaAssets.push(asset);
      console.log(`📎 LinkedIn video file ${i + 1} uploaded successfully, asset:`, asset);
    } catch (mediaError) {
      console.warn(`⚠️ LinkedIn video file ${i + 1} upload failed:`, mediaError.message);
    }
  }

  // Upload media from URLs
  for (let i = 0; i < mediaUrls.length; i++) {
    try {
      const isVideoUrl = /\.(mp4|mov|avi|wmv|flv|webm|m4v)(\?|$)/i.test(mediaUrls[i]);
      const asset = await uploadLinkedInMedia(null, mediaUrls[i], accessToken, userId, isVideoUrl);
      mediaAssets.push(asset);
      console.log(`📎 LinkedIn URL ${i + 1} uploaded successfully, asset:`, asset);
    } catch (mediaError) {
      console.warn(`⚠️ LinkedIn URL ${i + 1} upload failed:`, mediaError.message);
    }
  }

  const postPayload = {
    author: `urn:li:person:${userId}`,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: {
          text: content || ' '
        },
        shareMediaCategory: mediaAssets.length > 0 ? (videoFiles.length > 0 || mediaUrls.some(url => /\.(mp4|mov|avi|wmv|flv|webm|m4v)(\?|$)/i.test(url)) ? "VIDEO" : "IMAGE") : "NONE"
      }
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
    }
  };

  if (mediaAssets.length > 0) {
    postPayload.specificContent["com.linkedin.ugc.ShareContent"].media = mediaAssets.map((asset, index) => ({
      status: "READY",
      description: { text: `Media ${index + 1}` },
      media: asset,
      title: { text: `Media ${index + 1}` }
    }));
  }

  console.log('📝 Posting to LinkedIn with payload:', {
    hasMedia: mediaAssets.length > 0,
    mediaCount: mediaAssets.length,
    shareMediaCategory: postPayload.specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory
  });

  try {
    const response = await axios.post(
      'https://api.linkedin.com/v2/ugcPosts',
      postPayload,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0'
        },
        timeout: 30000
      }
    );

    console.log('📨 LinkedIn post response:', {
      status: response.status,
      postId: response.data?.id
    });

    if (response.data?.id) {
      return {
        success: true,
        platform: 'LinkedIn',
        postId: response.data.id,
        data: response.data,
        message: `LinkedIn post with ${mediaAssets.length} media file${mediaAssets.length !== 1 ? 's' : ''} published successfully!`
      };
    } else {
      throw new Error('Invalid response from LinkedIn API - no post ID returned');
    }

  } catch (postError) {
    console.error('❌ LinkedIn post failed:', {
      message: postError.message,
      status: postError.response?.status,
      statusText: postError.response?.statusText,
      data: postError.response?.data
    });

    let errorMessage = 'Failed to post to LinkedIn';
    if (postError.response?.data?.message) errorMessage = postError.response.data.message;
    else if (postError.response?.data?.error) errorMessage = postError.response.data.error;
    else if (postError.message) errorMessage = postError.message;

    if (postError.response?.status === 401) {
      errorMessage = 'LinkedIn authentication failed. Please reconnect your account.';
    } else if (postError.response?.status === 403) {
      errorMessage = 'Permission denied. Check your LinkedIn app permissions for posting.';
    } else if (postError.response?.status === 429) {
      errorMessage = 'LinkedIn rate limit exceeded. Please try again later.';
    }
    const retryAfter = postError.response?.headers?.['retry-after'];
    throw httpError(errorMessage, postError.response?.status || 500, retryAfter);
  }
}

// Twitter posting helper
async function postToTwitter({ content, accessToken, imageFiles = [], videoFiles = [], mediaUrls = [] }) {
  if (!accessToken) throw httpError('Twitter access token required', 400);
  if (!content && imageFiles.length === 0 && videoFiles.length === 0 && mediaUrls.length === 0) {
    throw httpError('Content or media required', 400);
  }

  try {
  let mediaIds = [];
    const maxMedia = 4; // Twitter limit
    let processedCount = 0;

    // Process image files (up to 4 total)
    for (let i = 0; i < Math.min(imageFiles.length, maxMedia - processedCount); i++) {
      try {
        const mediaId = await uploadTwitterMedia(imageFiles[i], null, accessToken, false);
        mediaIds.push(mediaId);
        processedCount++;
      } catch (err) {
        console.warn(`⚠️ Twitter image file ${i + 1} upload failed:`, err.message);
      }
    }

    // Process video files (Twitter supports 1 video OR up to 4 images)
    for (let i = 0; i < Math.min(videoFiles.length, 1); i++) {
      if (processedCount === 0) { // Only add video if no images were added
        try {
          const mediaId = await uploadTwitterMedia(videoFiles[i], null, accessToken, true);
      mediaIds.push(mediaId);
          processedCount++;
          break; // Twitter only supports 1 video per tweet
    } catch (err) {
          console.warn(`⚠️ Twitter video file ${i + 1} upload failed:`, err.message);
        }
      }
    }

    // Process URLs (remaining slots)
    const remainingSlots = maxMedia - processedCount;
    for (let i = 0; i < Math.min(mediaUrls.length, remainingSlots); i++) {
      try {
        const isVideoUrl = /\.(mp4|mov|avi|wmv|flv|webm|m4v)(\?|$)/i.test(mediaUrls[i]);
        if (isVideoUrl && mediaIds.length > 0) continue; // Skip if already have media (Twitter: 1 video OR multiple images)
        
        const mediaId = await uploadTwitterMedia(null, mediaUrls[i], accessToken, isVideoUrl);
      mediaIds.push(mediaId);
        if (isVideoUrl) break; // Only one video allowed
    } catch (err) {
      console.warn(`⚠️ Twitter URL ${i + 1} upload failed:`, err.message);
    }
  }

  const tweetPayload = { text: content || ' ' };
  if (mediaIds.length > 0) {
    tweetPayload.media = { media_ids: mediaIds };
  }

  const response = await axios.post('https://api.twitter.com/2/tweets', tweetPayload, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  if (response.data?.data) {
    return {
      success: true,
      platform: 'Twitter',
      postId: response.data.data.id,
      data: response.data.data,
        message: `Tweet with ${mediaIds.length} media file${mediaIds.length !== 1 ? 's' : ''} posted successfully!`
      };
    }
    throw httpError('Invalid response from Twitter API', 502);

  } catch (e) {
    const status = e.response?.status || e.status || 500;
    const retryAfter = e.response?.headers?.['retry-after'] || e.retryAfter;
    let message = 'Failed to post to Twitter';
    if (e.response?.data?.error) message = e.response.data.error;
    else if (e.message) message = e.message;
    if (status === 429 && !/rate limit/i.test(message)) {
      message = 'Twitter rate limit exceeded. Please try again later.';
    }
    throw httpError(message, status, retryAfter);
  }
}

// Facebook posting helper
async function postToFacebook({ content, pageId, pageToken, imageFiles = [], videoFiles = [], mediaUrls = [] }) {
  if (!pageId || !pageToken) throw httpError('Facebook page ID and token required', 400);
  if (!content && imageFiles.length === 0 && videoFiles.length === 0 && mediaUrls.length === 0) {
    throw httpError('Content or media required', 400);
  }

  try {
    const allImageFiles = imageFiles;
    const allVideoFiles = videoFiles;
    const imageUrls = mediaUrls.filter(url => !/\.(mp4|mov|avi|wmv|flv|webm|m4v)(\?|$)/i.test(url));
    const videoUrls = mediaUrls.filter(url => /\.(mp4|mov|avi|wmv|flv|webm|m4v)(\?|$)/i.test(url));
    
    // Handle single video post
    if (allVideoFiles.length === 1 && allImageFiles.length === 0 && imageUrls.length === 0 && videoUrls.length === 0) {
      const formData = new FormData();
      formData.append('source', allVideoFiles[0].buffer, {
        filename: allVideoFiles[0].originalname,
        contentType: allVideoFiles[0].mimetype
      });
      formData.append('description', content || '');
      formData.append('access_token', pageToken);

      const response = await axios.post(`https://graph.facebook.com/${pageId}/videos`, formData, {
        headers: formData.getHeaders(),
        timeout: 300000 // 5 minutes for video upload
      });

      if (response.data?.id) {
        return {
          success: true,
          platform: 'Facebook',
          postId: response.data.id,
          data: response.data,
          message: 'Facebook video post published successfully!'
        };
      }
    }
    
    // Handle single video URL post
    if (videoUrls.length === 1 && allVideoFiles.length === 0 && allImageFiles.length === 0 && imageUrls.length === 0) {
      const response = await axios.post(`https://graph.facebook.com/${pageId}/videos`, {
        file_url: videoUrls[0],
        description: content || '',
        access_token: pageToken
      });

      if (response.data?.id) {
        return {
          success: true,
          platform: 'Facebook',
          postId: response.data.id,
          data: response.data,
          message: 'Facebook video post published successfully!'
        };
      }
    }

    // Handle text-only post
    if (allImageFiles.length === 0 && allVideoFiles.length === 0 && imageUrls.length === 0 && videoUrls.length === 0) {
    const response = await axios.post(`https://graph.facebook.com/${pageId}/feed`, {
      message: content,
      access_token: pageToken
    });

    if (response.data?.id) {
      return {
        success: true,
        platform: 'Facebook',
        postId: response.data.id,
        data: response.data,
        message: 'Facebook post published successfully!'
      };
    }
    }
    
    // Handle single image post
    else if (allImageFiles.length === 1 && allVideoFiles.length === 0 && imageUrls.length === 0 && videoUrls.length === 0) {
      const formData = new FormData();
      formData.append('source', allImageFiles[0].buffer, {
        filename: allImageFiles[0].originalname,
        contentType: allImageFiles[0].mimetype
      });
      formData.append('caption', content || '');
      formData.append('access_token', pageToken);

      const response = await axios.post(`https://graph.facebook.com/${pageId}/photos`, formData, {
        headers: formData.getHeaders()
      });

      if (response.data?.id) {
        return {
          success: true,
          platform: 'Facebook',
          postId: response.data.id,
          data: response.data,
          message: 'Facebook image post published successfully!'
        };
      }
    }
    
    // Handle single image URL post
    else if (imageUrls.length === 1 && allImageFiles.length === 0 && allVideoFiles.length === 0 && videoUrls.length === 0) {
      const response = await axios.post(`https://graph.facebook.com/${pageId}/photos`, {
        url: imageUrls[0],
        caption: content || '',
        access_token: pageToken
      });

    if (response.data?.id) {
      return {
        success: true,
        platform: 'Facebook',
        postId: response.data.id,
        data: response.data,
          message: 'Facebook image post published successfully!'
        };
      }
    }
    
    // Handle multiple images (album)
    else if (allImageFiles.length > 1 || imageUrls.length > 1) {
    const photoIds = [];
    
      // Upload image files
      for (let i = 0; i < allImageFiles.length; i++) {
      try {
        const formData = new FormData();
          formData.append('source', allImageFiles[i].buffer, {
            filename: allImageFiles[i].originalname,
            contentType: allImageFiles[i].mimetype
          });
          formData.append('published', 'false');
        formData.append('access_token', pageToken);

        const uploadResponse = await axios.post(
          `https://graph.facebook.com/${pageId}/photos`,
          formData,
          { headers: formData.getHeaders() }
        );

        if (uploadResponse.data?.id) {
          photoIds.push(uploadResponse.data.id);
        }
      } catch (err) {
          console.warn(`⚠️ Facebook image file ${i + 1} upload failed:`, err.message);
      }
    }

      // Upload image URLs
    for (let i = 0; i < imageUrls.length; i++) {
      try {
        const uploadResponse = await axios.post(`https://graph.facebook.com/${pageId}/photos`, {
          url: imageUrls[i],
          published: false,
          access_token: pageToken
        });

        if (uploadResponse.data?.id) {
          photoIds.push(uploadResponse.data.id);
        }
      } catch (err) {
          console.warn(`⚠️ Facebook image URL ${i + 1} upload failed:`, err.message);
      }
    }

    if (photoIds.length > 0) {
      const albumResponse = await axios.post(`https://graph.facebook.com/${pageId}/feed`, {
        message: content || '',
        attached_media: photoIds.map(id => ({ media_fbid: id })),
        access_token: pageToken
      });

      if (albumResponse.data?.id) {
        return {
          success: true,
          platform: 'Facebook',
          postId: albumResponse.data.id,
          data: albumResponse.data,
            message: `Facebook album with ${photoIds.length} images published successfully!`
        };
      }
    }
  }

    throw httpError('Invalid response from Facebook API', 502);
  } catch (e) {
    const status = e.response?.status || e.status || 500;
    const retryAfter = e.response?.headers?.['retry-after'] || e.retryAfter;
    let message = 'Failed to post to Facebook';
    if (e.response?.data?.error?.message) message = e.response.data.error.message;
    else if (e.message) message = e.message;
    if (status === 429 && !/rate limit/i.test(message)) {
      message = 'Facebook rate limit exceeded. Please try again later.';
    }
    throw httpError(message, status, retryAfter);
  }
}

// Instagram posting helper
async function postToInstagram({ content, pageAccessToken, instagramAccountId, mediaUrls = [] }) {
  console.log('📷 Starting Instagram Graph API post:', {
    hasContent: !!content,
    mediaUrlCount: mediaUrls.length,
    hasPageToken: !!pageAccessToken,
    hasIgAccountId: !!instagramAccountId
  });

  if (!pageAccessToken || !instagramAccountId) {
    throw new Error('Instagram page access token and account ID are required');
  }

  if (!content && mediaUrls.length === 0) {
    throw new Error('Content or media are required for Instagram posts');
  }

  try {
    if (mediaUrls.length === 0) {
      throw new Error('Instagram requires at least one image or video. Text-only posts are not supported.');
    }

    console.log(`🔍 Validating ${mediaUrls.length} media URLs...`);
    const validUrls = [];
    const videoUrls = [];
    const imageUrls = [];
    
    for (const url of mediaUrls) {
      try {
        const response = await axios.head(url, { 
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; InstagramBot/1.0)'
          }
        });
        
        const contentType = response.headers['content-type'];
        if (contentType && contentType.startsWith('image/')) {
          imageUrls.push(url);
          validUrls.push({ url, type: 'image' });
        } else if (contentType && contentType.startsWith('video/')) {
          videoUrls.push(url);
          validUrls.push({ url, type: 'video' });
        } else {
          console.warn(`⚠️ URL is not valid media: ${url} (${contentType})`);
        }
        
      } catch (urlError) {
        console.error(`❌ URL validation failed: ${url}`, { message: urlError.message, status: urlError.response?.status });
      }
    }

    if (validUrls.length === 0) {
      throw new Error('No valid, accessible media URLs found. All media must be publicly accessible.');
    }

    console.log(`📷 Using ${validUrls.length}/${mediaUrls.length} validated URLs for Instagram post (${imageUrls.length} images, ${videoUrls.length} videos)`);

    // Instagram supports either 1 video OR 1-10 images, but not mixed content
    if (videoUrls.length > 0 && imageUrls.length > 0) {
      throw new Error('Instagram does not support mixing images and videos in the same post. Please post them separately.');
    }

    if (videoUrls.length > 1) {
      throw new Error('Instagram supports only 1 video per post.');
    }

    // Validate video requirements for Reels
    if (videoUrls.length === 1) {
      console.log('📷 Validating video requirements for Instagram Reels...');
      // Instagram Reels requirements:
      // - Aspect ratio: 9:16 (portrait)
      // - Duration: 3-90 seconds
      // - File size: Up to 4GB
      // - Format: MP4
      try {
        const videoUrl = videoUrls[0];
        const response = await axios.head(videoUrl, { 
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; InstagramBot/1.0)'
          }
        });
        
        const contentType = response.headers['content-type'];
        if (!contentType || !contentType.startsWith('video/')) {
          throw new Error('Invalid video format. Instagram Reels require MP4 video files.');
        }
        
        console.log('✅ Video format validated for Instagram Reels');
      } catch (validationError) {
        console.warn('⚠️ Could not validate video format:', validationError.message);
      }
    }

    if (validUrls.length === 1) {
      console.log(`📷 Creating single ${validUrls[0].type} Instagram post...`);
      const mediaItem = validUrls[0];
      
      const containerPayload = {
        [mediaItem.type === 'video' ? 'video_url' : 'image_url']: mediaItem.url,
          caption: content || '',
        media_type: mediaItem.type === 'video' ? 'REELS' : 'IMAGE',
          access_token: pageAccessToken
      };

      const containerResponse = await axios.post(
        `https://graph.facebook.com/v18.0/${instagramAccountId}/media`,
        containerPayload,
        { timeout: 60000 }
      );

      if (!containerResponse.data?.id) {
        throw new Error(`Failed to create Instagram media container: ${containerResponse.data?.error?.message || 'Unknown error'}`);
      }

      const containerId = containerResponse.data.id;
      console.log('✅ Instagram media container created:', containerId);

      // Wait for media processing and check status
      let isReady = false;
      let attempts = 0;
      const maxAttempts = 30; // 5 minutes total (30 * 10 seconds)
      
      while (!isReady && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds between checks
        attempts++;
        
        try {
          console.log(`📊 Checking media status (attempt ${attempts}/${maxAttempts})...`);
          const statusResponse = await axios.get(
            `https://graph.facebook.com/v18.0/${containerId}?fields=status_code,status&access_token=${pageAccessToken}`,
            { timeout: 10000 }
          );
          
          if (statusResponse.data.status_code === 'FINISHED') {
            isReady = true;
            console.log('✅ Media processing completed successfully');
          } else if (statusResponse.data.status_code === 'ERROR') {
            throw new Error(`Media processing failed: ${statusResponse.data.status || 'Unknown error'}`);
          } else {
            console.log(`⏳ Media still processing: ${statusResponse.data.status_code} - ${statusResponse.data.status || 'Processing...'}`);
          }
        } catch (statusError) {
          console.warn(`⚠️ Could not check media status (attempt ${attempts}):`, statusError.message);
          if (attempts === maxAttempts) {
            console.warn('⚠️ Proceeding with publish attempt despite status check failure');
            isReady = true; // Try to publish anyway
          }
        }
      }
      
      if (!isReady) {
        throw new Error('Media processing timed out. Please try again with a smaller video file.');
      }

      const publishPayload = {
          creation_id: containerId,
          access_token: pageAccessToken
      };
      
      const publishResponse = await axios.post(
        `https://graph.facebook.com/v18.0/${instagramAccountId}/media_publish`,
        publishPayload,
        { timeout: 60000 }
      );

      if (publishResponse.data?.id) {
        return {
          success: true,
          platform: 'Instagram',
          postId: publishResponse.data.id,
          data: publishResponse.data,
          message: `Instagram ${mediaItem.type} post published successfully!`
        };
      } else {
        throw new Error(`Failed to publish Instagram post: ${publishResponse.data?.error?.message || 'Unknown error'}`);
      }

    } else if (validUrls.length <= 10 && videoUrls.length === 0) {
      // Multiple images (carousel)
      console.log(`📷 Creating Instagram carousel post with ${validUrls.length} images...`);
      const containerIds = [];
      
      for (let i = 0; i < validUrls.length; i++) {
        try {
          console.log(`📤 Creating container for image ${i + 1}/${validUrls.length}...`);
          
          const containerResponse = await axios.post(
            `https://graph.facebook.com/v18.0/${instagramAccountId}/media`,
            {
              image_url: validUrls[i].url,
              is_carousel_item: true,
              access_token: pageAccessToken
            },
            { timeout: 60000 }
          );

          if (containerResponse.data?.id) {
            containerIds.push(containerResponse.data.id);
            console.log(`✅ Image ${i + 1} container created:`, containerResponse.data.id);
          }
          
          if (i < validUrls.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
        } catch (mediaError) {
          console.error(`❌ Image ${i + 1} container creation failed:`, mediaError.message);
        }
      }

      if (containerIds.length === 0) {
        throw new Error('Failed to create any Instagram media containers');
      }

      await new Promise(resolve => setTimeout(resolve, 5000));

      const carouselResponse = await axios.post(
        `https://graph.facebook.com/v18.0/${instagramAccountId}/media`,
        {
          media_type: 'CAROUSEL',
          children: containerIds.join(','),
          caption: content || '',
          access_token: pageAccessToken
        },
        { timeout: 60000 }
      );

      if (!carouselResponse.data?.id) {
        throw new Error(`Failed to create Instagram carousel container: ${carouselResponse.data?.error?.message || 'Unknown error'}`);
      }

      const carouselId = carouselResponse.data.id;
      console.log('✅ Carousel container created:', carouselId);

      await new Promise(resolve => setTimeout(resolve, 3000));

      const publishResponse = await axios.post(
        `https://graph.facebook.com/v18.0/${instagramAccountId}/media_publish`,
        {
          creation_id: carouselId,
          access_token: pageAccessToken
        },
        { timeout: 60000 }
      );

      if (publishResponse.data?.id) {
        return {
          success: true,
          platform: 'Instagram',
          postId: publishResponse.data.id,
          data: publishResponse.data,
          message: `Instagram carousel with ${containerIds.length} images published successfully!`
        };
      } else {
        throw new Error(`Failed to publish Instagram carousel: ${publishResponse.data?.error?.message || 'Unknown error'}`);
      }
    } else {
      throw new Error('Instagram supports maximum 10 images in a carousel, or 1 video per post');
    }

  } catch (postError) {
    console.error('❌ Instagram post failed:', {
      message: postError.message,
      status: postError.response?.status,
      statusText: postError.response?.statusText,
      data: postError.response?.data
    });

    let errorMessage = 'Failed to post to Instagram';
    if (postError.response?.data?.error?.message) {
      errorMessage = postError.response.data.error.message;
    } else if (postError.response?.data?.error?.error_user_msg) {
      errorMessage = postError.response.data.error.error_user_msg;
    } else if (postError.response?.status === 400) {
      errorMessage = 'Bad request. Check that media files are valid and accessible, and Instagram account is properly connected.';
    } else if (postError.response?.status === 403) {
      errorMessage = 'Permission denied. Ensure Instagram account has posting permissions and is a Business/Creator account.';
    } else if (postError.response?.status === 429) {
      errorMessage = 'Instagram rate limit exceeded. Please try again later.';
    } else if (postError.message) {
      errorMessage = postError.message;
    }

    const retryAfter = postError.response?.headers?.['retry-after'];
    throw httpError(errorMessage, postError.response?.status || 500, retryAfter);
  }
}

// Media upload helpers
async function uploadLinkedInMedia(mediaFile, mediaUrl, accessToken, userId, isVideo = false) {
  console.log(`💼 Starting LinkedIn ${isVideo ? 'video' : 'image'} upload...`);
  
  let mediaBuffer, contentType, filename;

  if (mediaFile) {
    mediaBuffer = mediaFile.buffer;
    contentType = mediaFile.mimetype;
    filename = mediaFile.originalname || `${isVideo ? 'video' : 'image'}.${isVideo ? 'mp4' : 'jpg'}`;
    console.log(`📁 Using uploaded file for LinkedIn:`, { size: mediaBuffer.length, type: contentType, filename });
  } else if (mediaUrl && mediaUrl.trim()) {
    console.log(`🔗 Fetching ${isVideo ? 'video' : 'image'} from URL for LinkedIn:`, mediaUrl);
    try {
      const mediaResponse = await axios.get(mediaUrl, { 
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: 5 * 1024 * 1024 * 1024, // 5GB for videos
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SocialMediaBot/1.0)' }
      });
      mediaBuffer = Buffer.from(mediaResponse.data);
      contentType = mediaResponse.headers['content-type'] || (isVideo ? 'video/mp4' : 'image/jpeg');
      const urlParts = mediaUrl.split('/');
      filename = urlParts[urlParts.length - 1] || `${isVideo ? 'video' : 'image'}.${isVideo ? 'mp4' : 'jpg'}`;
      console.log(`✅ ${isVideo ? 'Video' : 'Image'} fetched for LinkedIn:`, { size: mediaBuffer.length, type: contentType, filename });
    } catch (fetchError) {
      console.error(`❌ Failed to fetch ${isVideo ? 'video' : 'image'} for LinkedIn:`, fetchError.message);
      throw new Error(`Failed to fetch ${isVideo ? 'video' : 'image'}: ${fetchError.message}`);
    }
  } else {
    throw new Error(`No ${isVideo ? 'video' : 'image'} file or URL provided for LinkedIn`);
  }

  if (!mediaBuffer || mediaBuffer.length === 0) {
    throw new Error(`Empty ${isVideo ? 'video' : 'image'} buffer for LinkedIn`);
  }

  try {
    const recipe = isVideo ? 'urn:li:digitalmediaRecipe:feedshare-video' : 'urn:li:digitalmediaRecipe:feedshare-image';
    
    const initializePayload = {
      registerUploadRequest: {
        recipes: [recipe],
        owner: `urn:li:person:${userId}`,
        serviceRelationships: [
          { relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }
        ]
      }
    };

    const initResponse = await axios.post(
      'https://api.linkedin.com/v2/assets?action=registerUpload',
      initializePayload,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0'
        },
        timeout: 30000
      }
    );

    if (!initResponse.data?.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']) {
      throw new Error(`LinkedIn ${isVideo ? 'video' : 'image'} upload initialization failed - no upload URL received`);
    }

    const uploadUrl = initResponse.data.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
    const asset = initResponse.data.value.asset;

    console.log(`✅ LinkedIn ${isVideo ? 'video' : 'image'} upload initialized:`, { asset, uploadUrl: uploadUrl.substring(0, 50) + '...' });
    
    const uploadResponse = await axios.put(
      uploadUrl,
      mediaBuffer,
      {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: isVideo ? 300000 : 60000, // 5 minutes for videos, 1 minute for images
        maxContentLength: 5 * 1024 * 1024 * 1024
      }
    );

    if (uploadResponse.status !== 201 && uploadResponse.status !== 200) {
      throw new Error(`LinkedIn ${isVideo ? 'video' : 'image'} binary upload failed with status: ${uploadResponse.status}`);
    }

    console.log(`✅ LinkedIn ${isVideo ? 'video' : 'image'} binary upload successful`);
    return asset;

  } catch (uploadError) {
    console.error(`❌ LinkedIn ${isVideo ? 'video' : 'image'} upload failed:`, {
      message: uploadError.message,
      status: uploadError.response?.status,
      statusText: uploadError.response?.statusText,
      data: uploadError.response?.data
    });

    const errorMessage = uploadError.response?.data?.message || 
                        uploadError.response?.data?.error || 
                        uploadError.message || 
                        `LinkedIn ${isVideo ? 'video' : 'image'} upload failed`;
    const retryAfter = uploadError.response?.headers?.['retry-after'];
    throw httpError(`LinkedIn ${isVideo ? 'video' : 'image'} upload failed: ${errorMessage}`, uploadError.response?.status || 500, retryAfter);
  }
}

async function uploadTwitterMedia(mediaFile, mediaUrl, accessToken, isVideo = false) {
  console.log(`🐦 Starting Twitter ${isVideo ? 'video' : 'image'} upload...`);
  
  let mediaBuffer, contentType, filename;

  if (mediaFile) {
    mediaBuffer = mediaFile.buffer;
    contentType = mediaFile.mimetype;
    filename = mediaFile.originalname || `${isVideo ? 'video' : 'image'}.${isVideo ? 'mp4' : 'jpg'}`;
  } else if (mediaUrl && mediaUrl.trim()) {
    const mediaResponse = await axios.get(mediaUrl, { 
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: 512 * 1024 * 1024 // 512MB max for Twitter
    });
    
    mediaBuffer = Buffer.from(mediaResponse.data);
    contentType = mediaResponse.headers['content-type'] || (isVideo ? 'video/mp4' : 'image/jpeg');
    const urlParts = mediaUrl.split('/');
    filename = urlParts[urlParts.length - 1] || `${isVideo ? 'video' : 'image'}.${isVideo ? 'mp4' : 'jpg'}`;
  }

  if (!mediaBuffer) throw new Error(`No ${isVideo ? 'video' : 'image'} buffer available`);

  const formData = new FormData();
  formData.append('media', mediaBuffer, { filename, contentType });
  formData.append('media_category', isVideo ? 'tweet_video' : 'tweet_image');

  const uploadResponse = await axios.post(
    'https://upload.twitter.com/1.1/media/upload.json',
    formData,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        ...formData.getHeaders()
      },
      timeout: isVideo ? 300000 : 30000 // 5 minutes for videos, 30 seconds for images
    }
  );

  if (uploadResponse.data && uploadResponse.data.media_id_string) {
    return uploadResponse.data.media_id_string;
  } else {
    throw new Error(`Failed to get media ID from Twitter for ${isVideo ? 'video' : 'image'}`);
  }
}

module.exports = router;