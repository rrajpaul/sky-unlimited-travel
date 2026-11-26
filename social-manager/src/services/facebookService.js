const { graph, upload, step } = require('./metaHttp');
const fs = require('fs/promises');
const { config, assertConfigured } = require('../config');

/**
 * Publishes a photo post (image + caption) to the configured Facebook Page.
 * Uses the Page's /photos edge, which accepts a publicly reachable image URL.
 * Returns the Graph API response (contains post_id / id).
 */
async function postToFacebook({ imageUrl, caption }) {
  assertConfigured(['fbPageId', 'fbPageAccessToken']);

  const url = `https://graph.facebook.com/${config.graphApiVersion}/${config.fbPageId}/photos`;

  // Publishes immediately, so only retried if the request never got to Meta.
  const { data } = await step(
    'Facebook photo publish',
    () =>
      graph.post(url, null, {
        params: {
          url: imageUrl,
          caption,
          access_token: config.fbPageAccessToken,
        },
      }),
    { idempotent: false }
  );

  return data; // { id, post_id }
}

/**
 * Publishes a Reel to the configured Facebook Page, following Meta's
 * 3-step Reels Publishing API:
 *   1. POST /{page-id}/video_reels with upload_phase=start — returns a
 *      video_id.
 *   2. POST the actual video BYTES to rupload.facebook.com/video-upload/
 *      {video_id} (the "Upload a Local File" method, not the hosted-file/
 *      file_url method) — this pushes the file directly rather than
 *      asking Facebook to fetch it from a URL. That matters here
 *      specifically: the file_url method requires the hosting domain's
 *      robots.txt to allow Facebook's crawler, and Railway's default
 *      *.up.railway.app domains serve a platform-level robots.txt that
 *      blocks it (confirmed via a real FileUrlProcessingError / "403
 *      Restricted by robots.txt" during testing) — a restriction outside
 *      this app's own code. Uploading bytes directly sidesteps that
 *      entirely, and doesn't depend on ever configuring a custom domain.
 *   3. POST /{page-id}/video_reels with upload_phase=finish, video_state=
 *      PUBLISHED, and the caption (as `description`) — this actually
 *      publishes it.
 * Unlike the hosted-file method, a successful byte upload response means
 * Facebook has actually received the complete file already (no separate
 * "did the fetch finish yet" gap to poll for), so this goes straight to
 * step 3 once step 2 succeeds.
 */
async function postReelToFacebook({ videoFilePath, caption }) {
  assertConfigured(['fbPageId', 'fbPageAccessToken']);

  const startUrl = `https://graph.facebook.com/${config.graphApiVersion}/${config.fbPageId}/video_reels`;
  // An unused upload session is harmless, so this step can retry freely.
  const { data: startData } = await step(
    'Facebook Reel start',
    () =>
      graph.post(startUrl, null, {
        params: {
          upload_phase: 'start',
          access_token: config.fbPageAccessToken,
        },
      }),
    { idempotent: true }
  );

  const videoId = startData.video_id;
  if (!videoId) {
    throw new Error(
      `Facebook did not return a video_id when starting the Reel upload session. Response: ${JSON.stringify(startData)}`
    );
  }

  const videoBuffer = await fs.readFile(videoFilePath);

  const uploadUrl = `https://rupload.facebook.com/video-upload/${videoId}`;
  // Re-sending the whole file from offset 0 to the same video_id is safe.
  await step(
    'Facebook Reel upload',
    () =>
      upload.post(uploadUrl, videoBuffer, {
        headers: {
          Authorization: `OAuth ${config.fbPageAccessToken}`,
          'Content-Type': 'application/octet-stream',
          offset: '0',
          file_size: String(videoBuffer.length),
        },
      }),
    { idempotent: true }
  );

  const finishUrl = `https://graph.facebook.com/${config.graphApiVersion}/${config.fbPageId}/video_reels`;
  // This is the step that makes the Reel public.
  const { data: finishData } = await step(
    'Facebook Reel publish',
    () =>
      graph.post(finishUrl, null, {
        params: {
          access_token: config.fbPageAccessToken,
          video_id: videoId,
          upload_phase: 'finish',
          video_state: 'PUBLISHED',
          description: caption,
        },
      }),
    { idempotent: false }
  );

  // Meta's own docs show { success: true } here with no id — video_id is
  // the durable reference for this Reel, so it's included for anything
  // downstream (e.g. history) that wants to link back to it.
  return { ...finishData, video_id: videoId };
}

module.exports = { postToFacebook, postReelToFacebook };