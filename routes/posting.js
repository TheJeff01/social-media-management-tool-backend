const express = require('express');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'), false);
  }
});

// --------------------
// TWITTER HELPERS
// --------------------
async function uploadTwitterMedia(imageFile, imageUrl, accessToken) {
  let mediaBuffer, contentType;

  if (imageFile) {
    mediaBuffer = imageFile.buffer;
    contentType = imageFile.mimetype;
  } else if (imageUrl) {
    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    mediaBuffer = Buffer.from(imageResponse.data);
    contentType = imageResponse.headers['content-type'] || 'image/jpeg';
  }

  if (!mediaBuffer) throw new Error('No media buffer available');

  const formData = new FormData();
  formData.append('media', mediaBuffer, {
    filename: 'image.' + (contentType.split('/')[1] || 'jpg'),
    contentType
  });
  formData.append('media_category', 'tweet_image');

  const uploadResponse = await axios.post(
    'https://upload.twitter.com/1.1/media/upload.json',
    formData,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        ...formData.getHeaders()
      }
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
// FACEBOOK HELPERS
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
// LINKEDIN HELPERS
// --------------------
async function postToLinkedIn({ content, accessToken, userId }) {
  if (!accessToken || !userId) throw new Error('LinkedIn access token and user ID required');
  if (!content) throw new Error('Content required for LinkedIn posts');

  const postPayload = {
    author: `urn:li:person:${userId}`,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text: content },
        shareMediaCategory: "NONE"
      }
    },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" }
  };

  const response = await axios.post('https://api.linkedin.com/v2/ugcPosts', postPayload, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0'
    }
  });

  if (response.data?.id) {
    return {
      success: true,
      platform: 'LinkedIn',
      postId: response.data.id,
      data: response.data,
      message: 'LinkedIn post published successfully!'
    };
  }
  throw new Error('Invalid response from LinkedIn API');
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
    const result = await postToLinkedIn({
      content: req.body.content,
      accessToken: req.body.accessToken,
      userId: req.body.userId
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, platform: 'LinkedIn', error: error.message });
  }
});

// --------------------
// MULTI-PLATFORM ROUTE - FIXED
// --------------------
router.post('/multi', upload.single('image'), async (req, res) => {
  try {
    console.log('📤 Multi-platform request received:', {
      body: req.body,
      hasFile: !!req.file
    });

    const { content, platforms, credentials, imageUrl } = req.body;
    const imageFile = req.file;

    // Parse JSON strings back to objects/arrays
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

    console.log('📋 Parsed data:', {
      platforms: parsedPlatforms,
      credentials: Object.keys(parsedCredentials || {})
    });

    if (!Array.isArray(parsedPlatforms) || parsedPlatforms.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Platforms array required',
        received: parsedPlatforms
      });
    }

    if (!parsedCredentials || typeof parsedCredentials !== 'object') {
      return res.status(400).json({ 
        success: false,
        error: 'Credentials object required',
        received: parsedCredentials
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
              userId: parsedCredentials.linkedin.userId
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