const axios = require('axios');
const { config, assertConfigured } = require('../config');

const BASE = () => `https://graph.facebook.com/${config.graphApiVersion}`;

// How long to wait between status checks, and how many times to check
// before giving up. Instagram needs to fetch and process the image from
// imageUrl before it can be published — this usually takes a few seconds,
// but publishing too early fails with "Media ID is not available" even
// though the container was created successfully.
const STATUS_POLL_INTERVAL_MS = 2000;
const STATUS_POLL_MAX_ATTEMPTS = 10;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls a media container's status_code until it's FINISHED (ready to
 * publish) or ERROR (failed), or until we run out of attempts. Throws if
 * the container errors out or never finishes in time.
 */
async function waitForContainerReady(containerId) {
  for (let attempt = 0; attempt < STATUS_POLL_MAX_ATTEMPTS; attempt++) {
    const { data } = await axios.get(`${BASE()}/${containerId}`, {
      params: {
        fields: 'status_code',
        access_token: config.fbPageAccessToken,
      },
    });

    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR') {
      throw new Error(`Instagram media container failed to process (status_code: ERROR).`);
    }
    // Still IN_PROGRESS (or similar) — wait and check again.
    await sleep(STATUS_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Instagram media container did not finish processing after ${STATUS_POLL_MAX_ATTEMPTS} attempts.`
  );
}

/**
 * Publishing to Instagram via the Graph API is a three-step process:
 *   1. Create a media container referencing the public image URL + caption.
 *   2. Wait for that container to finish downloading/processing the image
 *      (publishing before this completes fails with "Media ID is not
 *      available" even though container creation itself succeeded).
 *   3. Publish the now-ready container.
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

  await waitForContainerReady(container.id);

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