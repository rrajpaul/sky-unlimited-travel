const axios = require('axios');
const { config, assertConfigured } = require('../config');

/**
 * Publishes a photo post (image + caption) to the configured Facebook Page.
 * Uses the Page's /photos edge, which accepts a publicly reachable image URL.
 * Returns the Graph API response (contains post_id / id).
 */
async function postToFacebook({ imageUrl, caption }) {
  assertConfigured(['fbPageId', 'fbPageAccessToken']);

  const url = `https://graph.facebook.com/${config.graphApiVersion}/${config.fbPageId}/photos`;

  const { data } = await axios.post(url, null, {
    params: {
      url: imageUrl,
      caption,
      access_token: config.fbPageAccessToken,
    },
  });

  return data; // { id, post_id }
}

module.exports = { postToFacebook };
