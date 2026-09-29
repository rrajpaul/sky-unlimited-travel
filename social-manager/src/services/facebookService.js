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

// How long to wait between video-status checks, and how many times to
// check before giving up. Video processing takes far longer than the
// image-container processing elsewhere in this app (Instagram's image
// containers usually finish in a few seconds; a 6-second Reel upload can
// take a couple of minutes), so this is a much longer allowance than the
// image polling loops use.
const REEL_STATUS_POLL_INTERVAL_MS = 5000;
const REEL_STATUS_POLL_MAX_ATTEMPTS = 60; // up to 5 minutes total

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls a Facebook video's status until uploading_phase reports complete
 * (or errors out), per Meta's documented Reels flow: the hosted-file
 * upload step returns { success: true } as soon as the fetch request is
 * accepted, not once Meta has actually finished retrieving and validating
 * the file — publishing before that finishes risks the same kind of
 * "not actually ready yet" failure Instagram's image containers can hit.
 */
async function waitForFacebookVideoUploaded(videoId) {
  for (let attempt = 0; attempt < REEL_STATUS_POLL_MAX_ATTEMPTS; attempt++) {
    const { data } = await axios.get(
      `https://graph.facebook.com/${config.graphApiVersion}/${videoId}`,
      {
        params: {
          fields: 'status',
          access_token: config.fbPageAccessToken,
        },
      }
    );

    const uploadStatus = data.status?.uploading_phase?.status;
    const videoStatus = data.status?.video_status;

    if (uploadStatus === 'error' || videoStatus === 'error' || videoStatus === 'upload_failed') {
      const message =
        data.status?.uploading_phase?.errors?.[0]?.message ||
        data.status?.processing_phase?.error?.message ||
        'Unknown error';
      throw new Error(`Facebook Reel upload failed: ${message}`);
    }

    if (uploadStatus === 'complete') return;

    await sleep(REEL_STATUS_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Facebook Reel upload did not finish after ${REEL_STATUS_POLL_MAX_ATTEMPTS} status checks.`
  );
}

/**
 * Publishes a Reel to the configured Facebook Page, following Meta's
 * 3-step Reels Publishing API:
 *   1. POST /{page-id}/video_reels with upload_phase=start — returns a
 *      video_id (the upload_url in the response isn't used here, since
 *      step 2 uses the hosted-file method instead of a raw byte upload).
 *   2. POST to rupload.facebook.com/video-upload/{video_id} with
 *      file_url pointing at our own publicly hosted MP4 — Meta fetches it
 *      from there directly, same idea as image posts, just a different
 *      host for video.
 *   3. POST /{page-id}/video_reels with upload_phase=finish, video_state=
 *      PUBLISHED, and the caption (as `description`) — this actually
 *      publishes it.
 * A status check is inserted between steps 2 and 3 (see
 * waitForFacebookVideoUploaded) since the hosted-file upload step returns
 * success as soon as the fetch is accepted, not once it's actually done.
 */
async function postReelToFacebook({ videoUrl, caption }) {
  assertConfigured(['fbPageId', 'fbPageAccessToken']);

  const startUrl = `https://graph.facebook.com/${config.graphApiVersion}/${config.fbPageId}/video_reels`;
  const { data: startData } = await axios.post(startUrl, null, {
    params: {
      upload_phase: 'start',
      access_token: config.fbPageAccessToken,
    },
  });

  const videoId = startData.video_id;
  if (!videoId) {
    throw new Error(
      `Facebook did not return a video_id when starting the Reel upload session. Response: ${JSON.stringify(startData)}`
    );
  }

  const uploadUrl = `https://rupload.facebook.com/video-upload/${videoId}`;
  await axios.post(uploadUrl, null, {
    headers: {
      Authorization: `OAuth ${config.fbPageAccessToken}`,
      file_url: videoUrl,
    },
  });

  await waitForFacebookVideoUploaded(videoId);

  const finishUrl = `https://graph.facebook.com/${config.graphApiVersion}/${config.fbPageId}/video_reels`;
  const { data: finishData } = await axios.post(finishUrl, null, {
    params: {
      access_token: config.fbPageAccessToken,
      video_id: videoId,
      upload_phase: 'finish',
      video_state: 'PUBLISHED',
      description: caption,
    },
  });

  // Meta's own docs show { success: true } here with no id — video_id is
  // the durable reference for this Reel, so it's included for anything
  // downstream (e.g. history) that wants to link back to it.
  return { ...finishData, video_id: videoId };
}

module.exports = { postToFacebook, postReelToFacebook };