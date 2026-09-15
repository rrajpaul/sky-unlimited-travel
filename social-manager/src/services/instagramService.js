const axios = require('axios');
const { config, assertConfigured } = require('../config');

const BASE = () => `https://graph.facebook.com/${config.graphApiVersion}`;

/**
 * Publishing to Instagram via the Graph API is a two-step process:
 *   1. Create a media container referencing the public image URL + caption.
 *   2. Publish that container.
 * Instagram reuses the linked Facebook Page's access token.
 */
async function postToInstagram({ imageUrl, caption }) {
  assertConfigured(['igBusinessAccountId', 'fbPageAccessToken']);

  const createUrl = `${BASE()}/${config.igBusinessAccountId}/media`;
  const { data: container } = await axios.post(createUrl, null, {
    params: {
      image_url: imageUrl,
      caption,
      access_token: config.fbPageAccessToken,
    },
  });

  const publishUrl = `${BASE()}/${config.igBusinessAccountId}/media_publish`;
  const { data: published } = await axios.post(publishUrl, null, {
    params: {
      creation_id: container.id,
      access_token: config.fbPageAccessToken,
    },
  });

  return published; // { id }
}

module.exports = { postToInstagram };
