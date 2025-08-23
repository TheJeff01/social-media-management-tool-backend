const express = require('express');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const router = express.Router();

// Configure multer for multiple file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per file
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'), false);
  }
});

// --------------------
// LINKEDIN HELPERS - UPDATED FOR MULTIPLE IMAGES
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
        timeout: 60000,
        maxContentLength: 10 * 1024 * 1024
      }
    );

    if (uploadResponse.status !== 201 && uploadResponse.status !== 200) {
      throw new Error(`LinkedIn binary upload failed with status: ${uploadResponse.status}`);
    }

    console.log('✅ LinkedIn binary upload successful');
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

async function postToLinkedIn({ content, accessToken, userId, imageFiles = [], imageUrls = [] }) {
  console.log('💼 Starting LinkedIn post:', {
    hasContent: !!content,
    imageFileCount: imageFiles.length,
    imageUrlCount: imageUrls.length,
    contentLength: content?.length || 0
  });

  if (!accessToken || !userId) {
    throw new Error('LinkedIn access token and user ID are required');
  }

  if (!content && imageFiles.length === 0 && imageUrls.length === 0) {
    throw new Error('Either content or images are required for LinkedIn posts');
  }

  let mediaAssets = [];
  
  // Upload files
  for (let i = 0; i < imageFiles.length; i++) {
    try {
      const asset = await uploadLinkedInMedia(imageFiles[i], null, accessToken, userId);
      mediaAssets.push(asset);
      console.log(`📎 LinkedIn file ${i + 1} uploaded successfully, asset:`, asset);
    } catch (mediaError) {
      console.warn(`⚠️ LinkedIn file ${i + 1} upload failed:`, mediaError.message);
    }
  }

  // Upload URLs
  for (let i = 0; i < imageUrls.length; i++) {
    try {
      const asset = await uploadLinkedInMedia(null, imageUrls[i], accessToken, userId);
      mediaAssets.push(asset);
      console.log(`📎 LinkedIn URL ${i + 1} uploaded successfully, asset:`, asset);
    } catch (mediaError) {
      console.warn(`⚠️ LinkedIn URL ${i + 1} upload failed:`, mediaError.message);
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
        shareMediaCategory: mediaAssets.length > 0 ? "IMAGE" : "NONE"
      }
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
    }
  };

  // Add media to the post if we have any
  if (mediaAssets.length > 0) {
    postPayload.specificContent["com.linkedin.ugc.ShareContent"].media = mediaAssets.map((asset, index) => ({
      status: "READY",
      description: {
        text: `Image ${index + 1}`
      },
      media: asset,
      title: {
        text: `Image ${index + 1}`
      }
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
        message: `LinkedIn post with ${mediaAssets.length} image${mediaAssets.length !== 1 ? 's' : ''} published successfully!`
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

    if (postError.response?.data?.message) {
      errorMessage = postError.response.data.message;
    } else if (postError.response?.data?.error) {
      errorMessage = postError.response.data.error;
    } else if (postError.message) {
      errorMessage = postError.message;
    }

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
// TWITTER HELPERS - UPDATED FOR MULTIPLE IMAGES
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

async function postToTwitter({ content, accessToken, imageFiles = [], imageUrls = [] }) {
  if (!accessToken) throw new Error('Twitter access token required');
  if (!content && imageFiles.length === 0 && imageUrls.length === 0) {
    throw new Error('Content or images required');
  }

  let mediaIds = [];
  
  // Twitter supports max 4 images per tweet
  const allImages = [...imageFiles, ...imageUrls];
  const maxImages = Math.min(allImages.length, 4);

  // Upload files
  for (let i = 0; i < Math.min(imageFiles.length, maxImages); i++) {
    try {
      const mediaId = await uploadTwitterMedia(imageFiles[i], null, accessToken);
      mediaIds.push(mediaId);
    } catch (err) {
      console.warn(`⚠️ Twitter file ${i + 1} upload failed:`, err.message);
    }
  }

  // Upload URLs (only if we haven't reached the limit)
  const remainingSlots = maxImages - mediaIds.length;
  for (let i = 0; i < Math.min(imageUrls.length, remainingSlots); i++) {
    try {
      const mediaId = await uploadTwitterMedia(null, imageUrls[i], accessToken);
      mediaIds.push(mediaId);
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
      message: `Tweet with ${mediaIds.length} image${mediaIds.length !== 1 ? 's' : ''} posted successfully!`
    };
  }
  throw new Error('Invalid response from Twitter API');
}

// --------------------
// FACEBOOK HELPERS - UPDATED FOR MULTIPLE IMAGES
// --------------------
async function postToFacebook({ content, pageId, pageToken, imageFiles = [], imageUrls = [] }) {
  if (!pageId || !pageToken) throw new Error('Facebook page ID and token required');
  if (!content && imageFiles.length === 0 && imageUrls.length === 0) {
    throw new Error('Content or images required');
  }

  const allImages = [...imageFiles, ...imageUrls];
  
  if (allImages.length === 0) {
    // Text-only post
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
  } else if (allImages.length === 1) {
    // Single image post
    let response;
    
    if (imageFiles.length > 0) {
      const formData = new FormData();
      formData.append('source', imageFiles[0].buffer, {
        filename: imageFiles[0].originalname,
        contentType: imageFiles[0].mimetype
      });
      formData.append('caption', content || '');
      formData.append('access_token', pageToken);

      response = await axios.post(`https://graph.facebook.com/${pageId}/photos`, formData, {
        headers: formData.getHeaders()
      });
    } else {
      response = await axios.post(`https://graph.facebook.com/${pageId}/photos`, {
        url: imageUrls[0],
        caption: content || '',
        access_token: pageToken
      });
    }

    if (response.data?.id) {
      return {
        success: true,
        platform: 'Facebook',
        postId: response.data.id,
        data: response.data,
        message: 'Facebook post with image published successfully!'
      };
    }
  } else {
    // Multiple images post (album)
    const photoIds = [];
    
    // Upload files
    for (let i = 0; i < imageFiles.length; i++) {
      try {
        const formData = new FormData();
        formData.append('source', imageFiles[i].buffer, {
          filename: imageFiles[i].originalname,
          contentType: imageFiles[i].mimetype
        });
        formData.append('published', 'false'); // Don't publish immediately
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
        console.warn(`⚠️ Facebook file ${i + 1} upload failed:`, err.message);
      }
    }

    // Upload URLs
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
        console.warn(`⚠️ Facebook URL ${i + 1} upload failed:`, err.message);
      }
    }

    if (photoIds.length > 0) {
      // Create album post
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
          message: `Facebook post with ${photoIds.length} images published successfully!`
        };
      }
    }
  }

  throw new Error('Invalid response from Facebook API');
}

// --------------------
// INDIVIDUAL ROUTES - UPDATED FOR MULTIPLE IMAGES
// --------------------
router.post('/twitter', upload.array('images', 4), async (req, res) => {
  try {
    const imageUrls = req.body.imageUrls ? req.body.imageUrls.split(',').map(url => url.trim()).filter(url => url) : [];
    
    const result = await postToTwitter({
      content: req.body.content,
      accessToken: req.body.accessToken,
      imageFiles: req.files || [],
      imageUrls: imageUrls
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, platform: 'Twitter', error: error.message });
  }
});

router.post('/facebook', upload.array('images', 10), async (req, res) => {
  try {
    const imageUrls = req.body.imageUrls ? req.body.imageUrls.split(',').map(url => url.trim()).filter(url => url) : [];
    
    const result = await postToFacebook({
      content: req.body.content,
      pageId: req.body.pageId,
      pageToken: req.body.pageToken,
      imageFiles: req.files || [],
      imageUrls: imageUrls
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, platform: 'Facebook', error: error.message });
  }
});

router.post('/linkedin', upload.array('images', 9), async (req, res) => {
  try {
    console.log('📥 LinkedIn route hit:', {
      hasContent: !!req.body.content,
      fileCount: req.files?.length || 0,
      hasImageUrls: !!req.body.imageUrls,
      hasToken: !!req.body.accessToken,
      hasUserId: !!req.body.userId
    });

    const imageUrls = req.body.imageUrls ? req.body.imageUrls.split(',').map(url => url.trim()).filter(url => url) : [];

    const result = await postToLinkedIn({
      content: req.body.content,
      accessToken: req.body.accessToken,
      userId: req.body.userId,
      imageFiles: req.files || [],
      imageUrls: imageUrls
    });
    res.json(result);
  } catch (error) {
    console.error('❌ LinkedIn route error:', error.message);
    res.status(500).json({ success: false, platform: 'LinkedIn', error: error.message });
  }
});

// --------------------
// MULTI-PLATFORM ROUTE - UPDATED FOR MULTIPLE IMAGES
// --------------------
router.post('/multi', upload.array('images', 10), async (req, res) => {
  try {
    console.log('📤 Multi-platform request received:', {
      body: req.body,
      fileCount: req.files?.length || 0
    });

    const { content, platforms, credentials, imageUrls } = req.body;
    const imageFiles = req.files || [];

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

    // Parse image URLs
    const parsedImageUrls = imageUrls ? imageUrls.split(',').map(url => url.trim()).filter(url => url) : [];

    const postPromises = parsedPlatforms.map(async (platform) => {
      console.log(`🚀 Posting to ${platform} with ${imageFiles.length} files and ${parsedImageUrls.length} URLs...`);
      
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
              imageFiles: imageFiles.slice(0, 4), // Twitter max 4 images
              imageUrls: parsedImageUrls.slice(0, 4 - imageFiles.length)
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
              imageFiles,
              imageUrls: parsedImageUrls
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
              imageFiles: imageFiles.slice(0, 9), // LinkedIn max 9 images
              imageUrls: parsedImageUrls.slice(0, 9 - imageFiles.length)
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
      failed: failed.length,
      totalImages: imageFiles.length + parsedImageUrls.length
    });

    res.json({
      success: successful.length > 0,
      totalPlatforms: parsedPlatforms.length,
      successful: successful.length,
      failed: failed.length,
      results,
      message: successful.length === parsedPlatforms.length
        ? `Successfully posted to all ${parsedPlatforms.length} platforms with ${imageFiles.length + parsedImageUrls.length} images!`
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