const express = require('express');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const router = express.Router();
const cloudinary = require('cloudinary').v2; // ✅ Added

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
async function convertFilesToCloudinaryUrls(imageFiles) {
  const imageUrls = [];
  
  for (let i = 0; i < imageFiles.length; i++) {
    const file = imageFiles[i];
    
    try {
      console.log(`☁️ Uploading ${file.originalname} to Cloudinary...`);
      
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          {
            resource_type: 'image',
            folder: 'instagram-posts',
            format: 'jpg',
            quality: 'auto:good',
            fetch_format: 'auto',
            transformation: [
              { width: 1080, height: 1080, crop: 'limit' }, // Optimal for Instagram
              { quality: 'auto:good' }
            ]
          },
          (error, result) => {
            if (error) {
              console.error('❌ Cloudinary upload error:', error);
              reject(error);
            } else {
              resolve(result);
            }
          }
        ).end(file.buffer);
      });
      
      imageUrls.push(result.secure_url);
      console.log(`✅ Cloudinary upload successful: ${result.secure_url}`);
      console.log(`📊 Image details: ${result.width}x${result.height}, ${result.format}, ${result.bytes} bytes`);
      
    } catch (error) {
      console.error(`❌ Cloudinary upload failed for ${file.originalname}:`, error.message);
      // Continue processing other files
    }
  }
  
  return imageUrls;
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
// MULTER CONFIGURATION
// --------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per file
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'), false);
  }
});

// --------------------
// LINKEDIN HELPERS - (unchanged)
// --------------------
async function uploadLinkedInMedia(imageFile, imageUrl, accessToken, userId) {
  console.log('💼 Starting LinkedIn media upload...');
  
  let mediaBuffer, contentType, filename;

  if (imageFile) {
    mediaBuffer = imageFile.buffer;
    contentType = imageFile.mimetype;
    filename = imageFile.originalname || 'image.jpg';
    console.log('📁 Using uploaded file for LinkedIn:', { size: mediaBuffer.length, type: contentType, filename });
  } else if (imageUrl && imageUrl.trim()) {
    console.log('🔗 Fetching image from URL for LinkedIn:', imageUrl);
    try {
      const imageResponse = await axios.get(imageUrl, { 
        responseType: 'arraybuffer',
        timeout: 10000,
        maxContentLength: 5 * 1024 * 1024,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SocialMediaBot/1.0)' }
      });
      mediaBuffer = Buffer.from(imageResponse.data);
      contentType = imageResponse.headers['content-type'] || 'image/jpeg';
      const urlParts = imageUrl.split('/');
      filename = urlParts[urlParts.length - 1] || 'image.jpg';
      console.log('✅ Image fetched for LinkedIn:', { size: mediaBuffer.length, type: contentType, filename });
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
    const initializePayload = {
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
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
      throw new Error('LinkedIn upload initialization failed - no upload URL received');
    }

    const uploadUrl = initResponse.data.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
    const asset = initResponse.data.value.asset;

    console.log('✅ LinkedIn upload initialized:', { asset, uploadUrl: uploadUrl.substring(0, 50) + '...' });

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
    const retryAfter = uploadError.response?.headers?.['retry-after'];
    throw httpError(`LinkedIn media upload failed: ${errorMessage}`, uploadError.response?.status || 500, retryAfter);
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
  
  for (let i = 0; i < imageFiles.length; i++) {
    try {
      const asset = await uploadLinkedInMedia(imageFiles[i], null, accessToken, userId);
      mediaAssets.push(asset);
      console.log(`📎 LinkedIn file ${i + 1} uploaded successfully, asset:`, asset);
    } catch (mediaError) {
      console.warn(`⚠️ LinkedIn file ${i + 1} upload failed:`, mediaError.message);
    }
  }

  for (let i = 0; i < imageUrls.length; i++) {
    try {
      const asset = await uploadLinkedInMedia(null, imageUrls[i], accessToken, userId);
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
        shareMediaCategory: mediaAssets.length > 0 ? "IMAGE" : "NONE"
      }
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
    }
  };

  if (mediaAssets.length > 0) {
    postPayload.specificContent["com.linkedin.ugc.ShareContent"].media = mediaAssets.map((asset, index) => ({
      status: "READY",
      description: { text: `Image ${index + 1}` },
      media: asset,
      title: { text: `Image ${index + 1}` }
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
// TWITTER HELPERS - (unchanged)
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
  formData.append('media', mediaBuffer, { filename, contentType });
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
  if (!accessToken) throw httpError('Twitter access token required', 400);
  if (!content && imageFiles.length === 0 && imageUrls.length === 0) {
    throw httpError('Content or images required', 400);
  }

  try {
    let mediaIds = [];
    const allImages = [...imageFiles, ...imageUrls];
    const maxImages = Math.min(allImages.length, 4);

    for (let i = 0; i < Math.min(imageFiles.length, maxImages); i++) {
      try {
        const mediaId = await uploadTwitterMedia(imageFiles[i], null, accessToken);
        mediaIds.push(mediaId);
      } catch (err) {
        console.warn(`⚠️ Twitter file ${i + 1} upload failed:`, err.message);
      }
    }

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
// FACEBOOK HELPERS - (unchanged)
// --------------------
async function postToFacebook({ content, pageId, pageToken, imageFiles = [], imageUrls = [] }) {
  if (!pageId || !pageToken) throw httpError('Facebook page ID and token required', 400);
  if (!content && imageFiles.length === 0 && imageUrls.length === 0) {
    throw httpError('Content or images required', 400);
  }

  try {
    const allImages = [...imageFiles, ...imageUrls];
    
    if (allImages.length === 0) {
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
      const photoIds = [];
      
      for (let i = 0; i < imageFiles.length; i++) {
        try {
          const formData = new FormData();
          formData.append('source', imageFiles[i].buffer, {
            filename: imageFiles[i].originalname,
            contentType: imageFiles[i].mimetype
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
          console.warn(`⚠️ Facebook file ${i + 1} upload failed:`, err.message);
        }
      }

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
// INSTAGRAM HELPERS - (unchanged)
// --------------------
async function postToInstagram({ content, pageAccessToken, instagramAccountId, imageUrls = [] }) {
  console.log('📷 Starting Instagram Graph API post:', {
    hasContent: !!content,
    imageUrlCount: imageUrls.length,
    hasPageToken: !!pageAccessToken,
    hasIgAccountId: !!instagramAccountId
  });

  if (!pageAccessToken || !instagramAccountId) {
    throw new Error('Instagram page access token and account ID are required');
  }

  if (!content && imageUrls.length === 0) {
    throw new Error('Content or images are required for Instagram posts');
  }

  try {
    if (imageUrls.length === 0) {
      throw new Error('Instagram requires at least one image. Text-only posts are not supported.');
    }

    console.log(`🔍 Validating ${imageUrls.length} image URLs...`);
    const validUrls = [];
    
    for (const url of imageUrls) {
      try {
        const response = await axios.head(url, { 
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; InstagramBot/1.0)'
          }
        });
        
        const contentType = response.headers['content-type'];
        if (contentType && contentType.startsWith('image/')) {
          validUrls.push(url);
        } else {
          console.warn(`⚠️ URL is not an image: ${url} (${contentType})`);
        }
        
      } catch (urlError) {
        console.error(`❌ URL validation failed: ${url}`, { message: urlError.message, status: urlError.response?.status });
      }
    }

    if (validUrls.length === 0) {
      throw new Error('No valid, accessible image URLs found. All images must be publicly accessible.');
    }

    console.log(`📷 Using ${validUrls.length}/${imageUrls.length} validated URLs for Instagram post`);

    if (validUrls.length === 1) {
      console.log('📷 Creating single image Instagram post...');
      const containerPayload = {
        image_url: validUrls[0],
        caption: content || '',
        access_token: pageAccessToken
      };
      
      const containerResponse = await axios.post(
        `https://graph.facebook.com/v18.0/${instagramAccountId}/media`,
        containerPayload,
        { timeout: 30000 }
      );

      if (!containerResponse.data?.id) {
        throw new Error(`Failed to create Instagram media container: ${containerResponse.data?.error?.message || 'Unknown error'}`);
      }

      const containerId = containerResponse.data.id;
      console.log('✅ Instagram media container created:', containerId);

      await new Promise(resolve => setTimeout(resolve, 3000));

      try {
        const statusResponse = await axios.get(
          `https://graph.facebook.com/v18.0/${containerId}?fields=status_code,status&access_token=${pageAccessToken}`,
          { timeout: 10000 }
        );
        if (statusResponse.data.status_code === 'ERROR') {
          throw new Error(`Media processing failed: ${statusResponse.data.status || 'Unknown error'}`);
        }
      } catch (statusError) {
        console.warn('⚠️ Could not check media status:', statusError.message);
      }

      const publishPayload = {
        creation_id: containerId,
        access_token: pageAccessToken
      };
      
      const publishResponse = await axios.post(
        `https://graph.facebook.com/v18.0/${instagramAccountId}/media_publish`,
        publishPayload,
        { timeout: 30000 }
      );

      if (publishResponse.data?.id) {
        return {
          success: true,
          platform: 'Instagram',
          postId: publishResponse.data.id,
          data: publishResponse.data,
          message: 'Instagram post published successfully!'
        };
      } else {
        throw new Error(`Failed to publish Instagram post: ${publishResponse.data?.error?.message || 'Unknown error'}`);
      }

    } else if (validUrls.length <= 10) {
      console.log(`📷 Creating Instagram carousel post with ${validUrls.length} images...`);
      const containerIds = [];
      
      for (let i = 0; i < validUrls.length; i++) {
        try {
          console.log(`📤 Creating container for image ${i + 1}/${validUrls.length}...`);
          
          const containerResponse = await axios.post(
            `https://graph.facebook.com/v18.0/${instagramAccountId}/media`,
            {
              image_url: validUrls[i],
              is_carousel_item: true,
              access_token: pageAccessToken
            },
            { timeout: 30000 }
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
        { timeout: 30000 }
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
        { timeout: 30000 }
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
      throw new Error('Instagram supports maximum 10 images in a carousel');
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
      errorMessage = 'Bad request. Check that images are valid and accessible, and Instagram account is properly connected.';
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

// ✅ Updated Instagram route using Cloudinary
router.post('/instagram', upload.array('images', 10), async (req, res) => {
  try {
    console.log('📥 Instagram posting route hit:', {
      hasContent: !!req.body.content,
      hasPageToken: !!req.body.pageAccessToken,
      hasIgAccountId: !!req.body.instagramAccountId,
      hasImageUrls: !!req.body.imageUrls,
      fileCount: req.files?.length || 0
    });

    let allImageUrls = [];
    
    // Upload files to Cloudinary
    if (req.files && req.files.length > 0) {
      console.log('☁️ Processing files through Cloudinary for Instagram...');
      const cloudinaryUrls = await convertFilesToCloudinaryUrls(req.files);
      allImageUrls.push(...cloudinaryUrls);
      console.log(`✅ ${cloudinaryUrls.length} files uploaded to Cloudinary`);
    }
    
    // Add provided URLs
    if (req.body.imageUrls) {
      const providedUrls = req.body.imageUrls.split(',')
        .map(url => url.trim())
        .filter(url => url);
      allImageUrls.push(...providedUrls);
      console.log(`📎 Added ${providedUrls.length} provided URLs`);
    }

    if (allImageUrls.length === 0) {
      return res.status(400).json({
        success: false,
        platform: 'Instagram',
        error: 'At least one image is required for Instagram posts'
      });
    }

    if (allImageUrls.length > 10) {
      return res.status(400).json({
        success: false,
        platform: 'Instagram',
        error: 'Instagram supports maximum 10 images in a carousel'
      });
    }

    console.log(`📷 Posting to Instagram with ${allImageUrls.length} images`);

    const result = await postToInstagram({
      content: req.body.content,
      pageAccessToken: req.body.pageAccessToken,
      instagramAccountId: req.body.instagramAccountId,
      imageUrls: allImageUrls
    });

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

// ✅ New: Test Cloudinary connection
router.get('/test-cloudinary', async (req, res) => {
  try {
    const result = await cloudinary.api.ping();
    res.json({
      success: true,
      message: 'Cloudinary connection successful',
      status: result.status,
      timestamp: new Date().toISOString()
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

// Other routes (unchanged)
router.post('/twitter', upload.array('images', 4), async (req, res) => {
  const imageUrls = req.body.imageUrls ? req.body.imageUrls.split(',').map(url => url.trim()).filter(url => url) : [];
  const result = await postToTwitter({ content: req.body.content, accessToken: req.body.accessToken, imageFiles: req.files || [], imageUrls });
  res.json(result);
});

router.post('/facebook', upload.array('images', 10), async (req, res) => {
  const imageUrls = req.body.imageUrls ? req.body.imageUrls.split(',').map(url => url.trim()).filter(url => url) : [];
  const result = await postToFacebook({ content: req.body.content, pageId: req.body.pageId, pageToken: req.body.pageToken, imageFiles: req.files || [], imageUrls });
  res.json(result);
});

router.post('/linkedin', upload.array('images', 9), async (req, res) => {
  const imageUrls = req.body.imageUrls ? req.body.imageUrls.split(',').map(url => url.trim()).filter(url => url) : [];
  const result = await postToLinkedIn({ content: req.body.content, accessToken: req.body.accessToken, userId: req.body.userId, imageFiles: req.files || [], imageUrls });
  res.json(result);
});

router.post('/multi', upload.array('images', 10), async (req, res) => {
  const { content, platforms, credentials, imageUrls } = req.body;
  const imageFiles = req.files || [];

  let parsedPlatforms, parsedCredentials;
  try {
    parsedPlatforms = typeof platforms === 'string' ? JSON.parse(platforms) : platforms;
    parsedCredentials = typeof credentials === 'string' ? JSON.parse(credentials) : credentials;
  } catch (parseError) {
    return res.status(400).json({ success: false, error: 'Invalid JSON data in request', details: parseError.message });
  }

  if (!Array.isArray(parsedPlatforms) || parsedPlatforms.length === 0) {
    return res.status(400).json({ success: false, error: 'Platforms array required' });
  }

  const parsedImageUrls = imageUrls ? imageUrls.split(',').map(url => url.trim()).filter(url => url) : [];

  const postPromises = parsedPlatforms.map(async (platform) => {
    try {
      let result;
      switch (platform.toLowerCase()) {
        case 'twitter':
          if (!parsedCredentials.twitter?.accessToken) throw new Error('Twitter credentials not found');
          result = await postToTwitter({
            content,
            accessToken: parsedCredentials.twitter.accessToken,
            imageFiles: imageFiles.slice(0, 4),
            imageUrls: parsedImageUrls.slice(0, 4 - imageFiles.length)
          });
          break;
          
        case 'facebook':
          if (!parsedCredentials.facebook?.pageId || !parsedCredentials.facebook?.pageToken) throw new Error('Facebook credentials not found');
          result = await postToFacebook({
            content,
            pageId: parsedCredentials.facebook.pageId,
            pageToken: parsedCredentials.facebook.pageToken,
            imageFiles,
            imageUrls: parsedImageUrls
          });
          break;
          
        case 'instagram':
          if (!parsedCredentials.instagram?.pageAccessToken || !parsedCredentials.instagram?.instagramAccountId) throw new Error('Instagram credentials not found');
          
          let allImageUrls = [];
          if (imageFiles.length > 0) {
            const cloudinaryUrls = await convertFilesToCloudinaryUrls(imageFiles);
            allImageUrls.push(...cloudinaryUrls);
          }
          allImageUrls.push(...parsedImageUrls.slice(0, 10 - allImageUrls.length));
          
          result = await postToInstagram({
            content,
            pageAccessToken: parsedCredentials.instagram.pageAccessToken,
            instagramAccountId: parsedCredentials.instagram.instagramAccountId,
            imageUrls: allImageUrls.slice(0, 10)
          });
          break;
          
        case 'linkedin':
          if (!parsedCredentials.linkedin?.accessToken || !parsedCredentials.linkedin?.userId) throw new Error('LinkedIn credentials not found');
          result = await postToLinkedIn({
            content,
            accessToken: parsedCredentials.linkedin.accessToken,
            userId: parsedCredentials.linkedin.userId,
            imageFiles: imageFiles.slice(0, 9),
            imageUrls: parsedImageUrls.slice(0, 9 - imageFiles.length)
          });
          break;
          
        default:
          throw new Error(`${platform} posting not implemented yet`);
      }
      return { platform, success: true, result };
    } catch (err) {
      return { platform, success: false, error: err.message };
    }
  });

  const results = await Promise.all(postPromises);
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

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
});

module.exports = router;