const express = require('express');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'), false);
  }
});

// --------------------
// LINKEDIN HELPERS - FIXED FOR IMAGES
// --------------------
async function uploadLinkedInMedia(imageFile, imageUrl, accessToken, userId) {
  console.log('💼 Starting LinkedIn media upload...');
  
  let mediaBuffer, contentType, filename;

  // Get image data
  if (imageFile) {
    mediaBuffer = imageFile.buffer;
    contentType = imageFile.mimetype;
    filename = imageFile.originalname || 'image.jpg';
    console.log('📁 Using uploaded file for LinkedIn:', { 
      size: mediaBuffer.length, 
      type: contentType,
      filename 
    });
  } else if (imageUrl && imageUrl.trim()) {
    console.log('🔗 Fetching image from URL for LinkedIn:', imageUrl);
    
    try {
      const imageResponse = await axios.get(imageUrl, { 
        responseType: 'arraybuffer',
        timeout: 10000,
        maxContentLength: 5 * 1024 * 1024, // 5MB limit
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SocialMediaBot/1.0)'
        }
      });
      
      mediaBuffer = Buffer.from(imageResponse.data);
      contentType = imageResponse.headers['content-type'] || 'image/jpeg';
      
      // Extract filename from URL or use default
      const urlParts = imageUrl.split('/');
      filename = urlParts[urlParts.length - 1] || 'image.jpg';
      
      console.log('✅ Image fetched for LinkedIn:', { 
        size: mediaBuffer.length, 
        type: contentType,
        filename 
      });
    } catch (fetchError) {
      console.error('❌ Failed to fetch image for LinkedIn:', fetchError.message);
      throw new Error(`Failed to fetch image: ${fetchError.message}`);
    }
  } else {
    throw new Error('No image file or URL provided for LinkedIn');
  }

  if (!mediaBuffer || mediaBuffer.length === 0) {
    throw new Error('Empty image buffer for LinkedIn');
  }

  // LinkedIn media upload is a 3-step process:
  // 1. Initialize upload
  // 2. Upload binary data
  // 3. Finalize upload

  try {
    // Step 1: Initialize the upload
    console.log('📤 Step 1: Initializing LinkedIn media upload...');
    
    const initializePayload = {
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
        owner: `urn:li:person:${userId}`,
        serviceRelationships: [
          {
            relationshipType: 'OWNER',
            identifier: 'urn:li:userGeneratedContent'
          }
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
      throw new Error('LinkedIn upload initialization failed - no upload URL received');
    }

    const uploadUrl = initResponse.data.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
    const asset = initResponse.data.value.asset;

    console.log('✅ LinkedIn upload initialized:', { asset, uploadUrl: uploadUrl.substring(0, 50) + '...' });

    // Step 2: Upload the binary data
    console.log('📤 Step 2: Uploading binary data to LinkedIn...');
    
    const uploadResponse = await axios.put(
      uploadUrl,
      mediaBuffer,
      {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: 60000, // Longer timeout for upload
        maxContentLength: 10 * 1024 * 1024 // 10MB max
      }
    );

    if (uploadResponse.status !== 201 && uploadResponse.status !== 200) {
      throw new Error(`LinkedIn binary upload failed with status: ${uploadResponse.status}`);
    }

    console.log('✅ LinkedIn binary upload successful');

    // Step 3: The asset is automatically finalized, so we return the asset URN
    return asset;

  } catch (uploadError) {
    console.error('❌ LinkedIn media upload failed:', {
      message: uploadError.message,
      status: uploadError.response?.status,
      statusText: uploadError.response?.statusText,
      data: uploadError.response?.data
    });

    const errorMessage = uploadError.response?.data?.message || 
                        uploadError.response?.data?.error || 
                        uploadError.message || 
                        'LinkedIn media upload failed';
    
    throw new Error(`LinkedIn media upload failed: ${errorMessage}`);
  }
}

async function postToLinkedIn({ content, accessToken, userId, imageFile, imageUrl }) {
  console.log('💼 Starting LinkedIn post:', {
    hasContent: !!content,
    hasImageFile: !!imageFile,
    hasImageUrl: !!imageUrl && imageUrl.trim(),
    contentLength: content?.length || 0
  });

  if (!accessToken || !userId) {
    throw new Error('LinkedIn access token and user ID are required');
  }

  if (!content && !imageFile && !imageUrl) {
    throw new Error('Either content or image is required for LinkedIn posts');
  }

  let mediaAsset = null;
  
  // Upload media if provided
  if (imageFile || (imageUrl && imageUrl.trim())) {
    try {
      mediaAsset = await uploadLinkedInMedia(imageFile, imageUrl, accessToken, userId);
      console.log('📎 LinkedIn media uploaded successfully, asset:', mediaAsset);
    } catch (mediaError) {
      console.warn('⚠️ LinkedIn media upload failed:', mediaError.message);
      // Continue without image - you can choose to throw here if image is mandatory
      // throw mediaError;
    }
  }

  // Prepare LinkedIn post payload
  const postPayload = {
    author: `urn:li:person:${userId}`,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: {
          text: content || ' '
        },
        shareMediaCategory: mediaAsset ? "IMAGE" : "NONE"
      }
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
    }
  };

  // Add media to the post if we have it
  if (mediaAsset) {
    postPayload.specificContent["com.linkedin.ugc.ShareContent"].media = [
      {
        status: "READY",
        description: {
          text: content || 'Image post'
        },
        media: mediaAsset,
        title: {
          text: "Image"
        }
      }
    ];
  }

  console.log('📝 Posting to LinkedIn with payload:', {
    hasMedia: !!mediaAsset,
    shareMediaCategory: postPayload.specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory
  });

  try {
    // Post to LinkedIn
    const response = await axios.post(
      'https://api.linkedin.com/v2/ugcPosts',
      postPayload,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0'
        },
        timeout: 15000
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
        message: mediaAsset ? 'LinkedIn post with image published successfully!' : 'LinkedIn post published successfully!'
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

    // Provide more specific error messages
    const errorData = postError.response?.data;
    let errorMessage = 'Failed to post to LinkedIn';

    if (errorData?.message) {
      errorMessage = errorData.message;
    } else if (errorData?.error) {
      errorMessage = errorData.error;
    } else if (postError.message) {
      errorMessage = postError.message;
    }

    // Handle specific LinkedIn API errors
    if (postError.response?.status === 401) {
      errorMessage = 'LinkedIn authentication failed. Please reconnect your account.';
    } else if (postError.response?.status === 403) {
      errorMessage = 'Permission denied. Check your LinkedIn app permissions for posting.';
    } else if (postError.response?.status === 429) {
      errorMessage = 'LinkedIn rate limit exceeded. Please try again later.';
    }

    throw new Error(errorMessage);
  }
}

// --------------------
// TWITTER HELPERS (unchanged from previous version)
// --------------------
async function uploadTwitterMedia(imageFile, imageUrl, accessToken) {
  console.log('🐦 Starting Twitter media upload...');
  
  let mediaBuffer, contentType, filename;

  if (imageFile) {
    mediaBuffer = imageFile.buffer;
    contentType = imageFile.mimetype;
    filename = imageFile.originalname || 'image.jpg';
  } else if (imageUrl && imageUrl.trim()) {
    const imageResponse = await axios.get(imageUrl, { 
      responseType: 'arraybuffer',
      timeout: 10000,
      maxContentLength: 5 * 1024 * 1024
    });
    
    mediaBuffer = Buffer.from(imageResponse.data);
    contentType = imageResponse.headers['content-type'] || 'image/jpeg';
    const urlParts = imageUrl.split('/');
    filename = urlParts[urlParts.length - 1] || 'image.jpg';
  }

  if (!mediaBuffer) throw new Error('No media buffer available');

  const formData = new FormData();
  formData.append('media', mediaBuffer, {
    filename: filename,
    contentType: contentType
  });
  formData.append('media_category', 'tweet_image');

  const uploadResponse = await axios.post(
    'https://upload.twitter.com/1.1/media/upload.json',
    formData,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        ...formData.getHeaders()
      },
      timeout: 30000
    }
  );

  if (uploadResponse.data && uploadResponse.data.media_id_string) {
    return uploadResponse.data.media_id_string;
  } else {
    throw new Error('Failed to get media ID from Twitter');
  }
}

async function postToTwitter({ content, accessToken, imageFile, imageUrl }) {
  if (!accessToken) throw new Error('Twitter access token required');
  if (!content && !imageFile && !imageUrl) throw new Error('Content or image required');

  let mediaId = null;
  if (imageFile || imageUrl) {
    try {
      mediaId = await uploadTwitterMedia(imageFile, imageUrl, accessToken);
    } catch (err) {
      console.warn('⚠️ Twitter media upload failed:', err.message);
    }
  }

  const tweetPayload = { text: content || ' ' };
  if (mediaId) {
    tweetPayload.media = { media_ids: [mediaId] };
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
      message: 'Tweet posted successfully!'
    };
  }
  throw new Error('Invalid response from Twitter API');
}

// --------------------
// FACEBOOK HELPERS (unchanged)
// --------------------
async function postToFacebook({ content, pageId, pageToken, imageFile, imageUrl }) {
  if (!pageId || !pageToken) throw new Error('Facebook page ID and token required');
  if (!content && !imageFile && !imageUrl) throw new Error('Content or image required');

  let response;
  if (imageFile) {
    const formData = new FormData();
    formData.append('source', imageFile.buffer, {
      filename: imageFile.originalname,
      contentType: imageFile.mimetype
    });
    formData.append('caption', content || '');
    formData.append('access_token', pageToken);

    response = await axios.post(`https://graph.facebook.com/${pageId}/photos`, formData, {
      headers: formData.getHeaders()
    });
  } else if (imageUrl && imageUrl.trim()) {
    response = await axios.post(`https://graph.facebook.com/${pageId}/photos`, {
      url: imageUrl,
      caption: content || '',
      access_token: pageToken
    });
  } else {
    response = await axios.post(`https://graph.facebook.com/${pageId}/feed`, {
      message: content,
      access_token: pageToken
    });
  }

  if (response.data?.id) {
    return {
      success: true,
      platform: 'Facebook',
      postId: response.data.id,
      data: response.data,
      message: 'Facebook post published successfully!'
    };
  }
  throw new Error('Invalid response from Facebook API');
}

// --------------------
// INDIVIDUAL ROUTES
// --------------------
router.post('/twitter', upload.single('image'), async (req, res) => {
  try {
    const result = await postToTwitter({
      content: req.body.content,
      accessToken: req.body.accessToken,
      imageFile: req.file,
      imageUrl: req.body.imageUrl
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, platform: 'Twitter', error: error.message });
  }
});

router.post('/facebook', upload.single('image'), async (req, res) => {
  try {
    const result = await postToFacebook({
      content: req.body.content,
      pageId: req.body.pageId,
      pageToken: req.body.pageToken,
      imageFile: req.file,
      imageUrl: req.body.imageUrl
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, platform: 'Facebook', error: error.message });
  }
});

router.post('/linkedin', upload.single('image'), async (req, res) => {
  try {
    console.log('📥 LinkedIn route hit:', {
      hasContent: !!req.body.content,
      hasFile: !!req.file,
      hasImageUrl: !!req.body.imageUrl,
      hasToken: !!req.body.accessToken,
      hasUserId: !!req.body.userId
    });

    const result = await postToLinkedIn({
      content: req.body.content,
      accessToken: req.body.accessToken,
      userId: req.body.userId,
      imageFile: req.file,
      imageUrl: req.body.imageUrl
    });
    res.json(result);
  } catch (error) {
    console.error('❌ LinkedIn route error:', error.message);
    res.status(500).json({ success: false, platform: 'LinkedIn', error: error.message });
  }
});

// --------------------
// MULTI-PLATFORM ROUTE - UPDATED
// --------------------
router.post('/multi', upload.single('image'), async (req, res) => {
  try {
    console.log('📤 Multi-platform request received:', {
      body: req.body,
      hasFile: !!req.file
    });

    const { content, platforms, credentials, imageUrl } = req.body;
    const imageFile = req.file;

    let parsedPlatforms;
    let parsedCredentials;

    try {
      parsedPlatforms = typeof platforms === 'string' ? JSON.parse(platforms) : platforms;
      parsedCredentials = typeof credentials === 'string' ? JSON.parse(credentials) : credentials;
    } catch (parseError) {
      console.error('❌ JSON parsing error:', parseError);
      return res.status(400).json({ 
        success: false,
        error: 'Invalid JSON data in request',
        details: parseError.message 
      });
    }

    if (!Array.isArray(parsedPlatforms) || parsedPlatforms.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Platforms array required'
      });
    }

    const postPromises = parsedPlatforms.map(async (platform) => {
      console.log(`🚀 Posting to ${platform}...`);
      
      try {
        let result;
        switch (platform.toLowerCase()) {
          case 'twitter':
            if (!parsedCredentials.twitter?.accessToken) {
              throw new Error('Twitter credentials not found');
            }
            result = await postToTwitter({
              content,
              accessToken: parsedCredentials.twitter.accessToken,
              imageFile,
              imageUrl
            });
            break;
            
          case 'facebook':
            if (!parsedCredentials.facebook?.pageId || !parsedCredentials.facebook?.pageToken) {
              throw new Error('Facebook credentials not found');
            }
            result = await postToFacebook({
              content,
              pageId: parsedCredentials.facebook.pageId,
              pageToken: parsedCredentials.facebook.pageToken,
              imageFile,
              imageUrl
            });
            break;
            
          case 'linkedin':
            if (!parsedCredentials.linkedin?.accessToken || !parsedCredentials.linkedin?.userId) {
              throw new Error('LinkedIn credentials not found');
            }
            result = await postToLinkedIn({
              content,
              accessToken: parsedCredentials.linkedin.accessToken,
              userId: parsedCredentials.linkedin.userId,
              imageFile,
              imageUrl
            });
            break;
            
          default:
            throw new Error(`${platform} posting not implemented yet`);
        }
        
        console.log(`✅ ${platform} posted successfully:`, result.postId);
        return { platform, success: true, result };
        
      } catch (err) {
        console.error(`❌ ${platform} posting failed:`, err.message);
        return { platform, success: false, error: err.message };
      }
    });

    const results = await Promise.all(postPromises);
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log('📊 Multi-platform results:', {
      total: parsedPlatforms.length,
      successful: successful.length,
      failed: failed.length
    });

    res.json({
      success: successful.length > 0,
      totalPlatforms: parsedPlatforms.length,
      successful: successful.length,
      failed: failed.length,
      results,
      message: successful.length === parsedPlatforms.length
        ? `Successfully posted to all ${parsedPlatforms.length} platforms!`
        : `Posted to ${successful.length} out of ${parsedPlatforms.length} platforms`
    });

  } catch (error) {
    console.error('❌ Multi-platform posting error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

module.exports = router;