const { generatePost, generateGiveawayPost, generateReelPost } = require('./contentGenerator');
const {
  generateImage,
  generatePhotoCard,
  generateIllustrationCard,
  generateChecklistCard,
  generateGiveawayCard,
} = require('./imageGenerator');
const { generateReelVideo } = require('./videoGenerator');
const { pickNextPhoto, listPhotos } = require('./photoLibrary');
const { getActiveGiveaway } = require('./giveawayService');
const { postToFacebook, postReelToFacebook } = require('./facebookService');
const { postToInstagram, postReelToInstagram } = require('./instagramService');
const { appendHistory, readHistory } = require('./historyStore');
const { config } = require('../config');

// Chance (0-1) of using a real photo as the background for a quote/tip/
// spotlight post, when the photo library actually has photos available.
// The rest of the time, and always when the library is empty, those post
// types fall back to the plain gradient card. Set to 1 so real travel
// photos are used whenever the library has one, since the whole point of
// loading 186 real photos was to feature them prominently.
const PHOTO_CARD_PROBABILITY = 1;

// Network retries now happen per step inside facebookService.js /
// instagramService.js (see metaHttp.js), so a dropped connection on the
// final publish call can't cause a second, duplicate post.

/**
 * Publishes to one platform, recording either the result or the error on
 * `result`. One platform failing never stops the other.
 */
async function publish(result, platform, fn) {
  try {
    result[platform] = await fn();
  } catch (err) {
    result.errors.push({ platform, message: describeError(err) });
  }
}

// ---------------------------------------------------------------------------
// Avoid repeating recent headlines
// ---------------------------------------------------------------------------
//
// History showed the same headline going out several times (e.g. "Book
// Flights on Tuesday Afternoons for Better Deals" on Oct 2, 12 and 22).
// Before posting, compare the new headline against roughly the last month
// of real posts and regenerate if it's an exact repeat (ignoring case and
// punctuation). If every attempt still repeats, post anyway rather than
// skip the day.
//
// (contentGenerator.js separately shows recent headlines to the model so
// it avoids near-duplicates too; this check is the exact-repeat backstop.)
const RECENT_HEADLINE_WINDOW = 60; // ~30 days at 2 posts/day
const MAX_HEADLINE_ATTEMPTS = 3;

function normalizeHeadline(headline) {
  return (headline || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function getRecentHeadlines() {
  try {
    const history = await readHistory();
    return history
      .filter((entry) => !entry.dryRun && entry.headline)
      .slice(0, RECENT_HEADLINE_WINDOW)
      .map((entry) => entry.headline);
  } catch (err) {
    // Never let a history read failure block the day's post.
    console.warn('[postJob] Could not read history for duplicate check:', err.message);
    return [];
  }
}

async function generateFreshPost(generate, recentHeadlines) {
  const seen = new Set(recentHeadlines.map(normalizeHeadline));
  let post;
  for (let attempt = 1; attempt <= MAX_HEADLINE_ATTEMPTS; attempt++) {
    post = await generate();
    if (!seen.has(normalizeHeadline(post.headline))) return post;
    console.warn(
      `[postJob] Headline "${post.headline}" was used recently ` +
        `(attempt ${attempt} of ${MAX_HEADLINE_ATTEMPTS}); regenerating.`
    );
  }
  return post;
}

/**
 * Picks and runs the right image renderer for a generated post. Keeps this
 * decision in one place so postJob doesn't need to know rendering details.
 *
 * `dryRun` matters here specifically because of the photo cursor: pickNextPhoto()
 * advances a persisted pointer through the library, and a /api/preview call
 * that never actually posts shouldn't consume a "turn" in that rotation —
 * otherwise repeatedly previewing would skip photos that never got posted.
 */
async function renderPostImage(post, { dryRun } = {}) {
  if (post.postType === 'illustration') {
    return generateIllustrationCard({ headline: post.headline, theme: post.image_theme });
  }

  if (post.postType === 'checklist') {
    return generateChecklistCard({
      title: post.headline,
      items: post.items,
      theme: post.image_theme,
    });
  }

  // travel_quote / travel_tip / destination_spotlight: use a real photo as
  // the background when the library has one, otherwise fall back to the
  // gradient card. Photos are picked in order (not randomly) so the whole
  // library gets used evenly. The coin flip happens BEFORE advancing the
  // cursor, so a photo is only marked "used" when it's actually rendered.
  const photos = await listPhotos();
  const usePhoto = photos.length > 0 && Math.random() < PHOTO_CARD_PROBABILITY;

  if (usePhoto) {
    const photoPath = dryRun ? photos[0] : await pickNextPhoto();
    return generatePhotoCard({ headline: post.headline, photoPath });
  }

  return generateImage({ headline: post.headline, theme: post.image_theme });
}

/**
 * Runs the full daily pipeline:
 *   1. Ask Claude for post content, regenerating if the headline repeats a
 *      recent post.
 *   2. Render that into a branded square image.
 *   3. Publish the image + caption to Facebook and Instagram, retrying
 *      transient network failures.
 *   4. Log the outcome (including partial failures) to history.
 *
 * `dryRun: true` generates content + image but skips actually posting —
 * useful for the /preview endpoint.
 */
async function runDailyPost({ dryRun = false, slot = 1, postType } = {}) {
  const recentHeadlines = await getRecentHeadlines();
  const post = await generateFreshPost(
    () => generatePost({ slot, postType }),
    recentHeadlines
  );
  const image = await renderPostImage(post, { dryRun });

  if (!image.publicUrl && !dryRun) {
    throw new Error(
      'PUBLIC_BASE_URL is not configured, so the generated image has no public URL for Meta to fetch. Set PUBLIC_BASE_URL in .env, or use dryRun/preview mode.'
    );
  }

  const result = {
    postType: post.postType,
    headline: post.headline,
    caption: post.caption,
    items: post.items || null,
    imageTheme: post.image_theme,
    imageFile: image.fileName,
    imagePublicUrl: image.publicUrl,
    // Which real photo was used as this post's background — null for
    // illustration/checklist/gradient posts.
    sourcePhotoFile: image.sourcePhotoFile || null,
    dryRun,
    facebook: null,
    instagram: null,
    errors: [],
  };

  if (!dryRun) {
    await publish(result, 'facebook', () =>
      postToFacebook({ imageUrl: image.publicUrl, caption: post.caption })
    );
    await publish(result, 'instagram', () =>
      postToInstagram({ imageUrl: image.publicUrl, caption: post.caption })
    );
  }

  // A DB failure here must not erase or hide a post that may have already
  // gone out successfully above.
  try {
    return await appendHistory(result);
  } catch (err) {
    console.error('[postJob] Failed to save post result to history:', err.message);
    return result;
  }
}

/**
 * Third, independent daily post: only posts when a giveaway is currently
 * active on the main website. When there isn't one, returns
 * `{ skipped: true }` and does NOT write to history.
 *
 * `dryRun: true` still generates real content + image from whatever
 * giveaway IS currently active, but never posts.
 */
async function runGiveawayPost({ dryRun = false } = {}) {
  const giveaway = await getActiveGiveaway();

  if (!giveaway) {
    return {
      postType: 'giveaway',
      skipped: true,
      reason: 'No active giveaway right now.',
      dryRun,
      timestamp: new Date().toISOString(),
    };
  }

  const post = await generateGiveawayPost({ giveaway, pageUrl: config.giveawayPageUrl });

  const prizeLabel = `$${post.prizeValueUsd} USD`;
  const image = await generateGiveawayCard({
    headline: post.headline,
    prizeLabel,
    destination: post.destination,
    theme: post.image_theme,
  });

  if (!image.publicUrl && !dryRun) {
    throw new Error(
      'PUBLIC_BASE_URL is not configured, so the generated image has no public URL for Meta to fetch. Set PUBLIC_BASE_URL in .env, or use dryRun/preview mode.'
    );
  }

  const result = {
    postType: 'giveaway',
    skipped: false,
    headline: post.headline,
    caption: post.caption,
    prizeValueUsd: post.prizeValueUsd,
    prizeValueCad: post.prizeValueCad,
    destination: post.destination,
    imageTheme: post.image_theme,
    imageFile: image.fileName,
    imagePublicUrl: image.publicUrl,
    dryRun,
    facebook: null,
    instagram: null,
    errors: [],
  };

  if (!dryRun) {
    await publish(result, 'facebook', () =>
      postToFacebook({ imageUrl: image.publicUrl, caption: post.caption })
    );
    await publish(result, 'instagram', () =>
      postToInstagram({ imageUrl: image.publicUrl, caption: post.caption })
    );
  }

  try {
    return await appendHistory(result);
  } catch (err) {
    console.error('[postJob] Failed to save giveaway post result to history:', err.message);
    return result;
  }
}

/**
 * Posts a Reel (short vertical video) — what the 11am slot runs every day
 * (see scheduler.js). Always uses a real photo, and shares the same
 * photo rotation as the image posts.
 *
 * Posts to BOTH Facebook and Instagram Reels independently: one platform
 * failing doesn't stop the other, and both get recorded in `errors`.
 *
 * `dryRun: true` still fully renders the video but skips publishing.
 */
async function runReelPost({ dryRun = false } = {}) {
  const recentHeadlines = await getRecentHeadlines();
  const post = await generateFreshPost(
    () => generateReelPost(),
    recentHeadlines
  );

  // Like renderPostImage: a preview must not advance the photo rotation,
  // or every /api/reel-preview would skip a photo that never got posted.
  const photoPath = dryRun ? (await listPhotos())[0] || null : await pickNextPhoto();
  if (!photoPath) {
    throw new Error('No photos available in the library to build a Reel from.');
  }

  const video = await generateReelVideo({ headline: post.headline, photoPath });

  if (!video.publicUrl && !dryRun) {
    throw new Error(
      'PUBLIC_BASE_URL is not configured, so the generated Reel has no public URL for Meta to fetch. Set PUBLIC_BASE_URL in .env, or use dryRun/preview mode.'
    );
  }

  const result = {
    postType: 'reel',
    headline: post.headline,
    caption: post.caption,
    videoFile: video.fileName,
    videoPublicUrl: video.publicUrl,
    sourcePhotoFile: video.sourcePhotoFile,
    dryRun,
    facebook: null,
    instagram: null,
    errors: [],
  };

  if (!dryRun) {
    await publish(result, 'facebook', () =>
      postReelToFacebook({ videoFilePath: video.filePath, caption: post.caption })
    );
    await publish(result, 'instagram', () =>
      postReelToInstagram({ videoUrl: video.publicUrl, caption: post.caption })
    );
  }

  try {
    return await appendHistory(result);
  } catch (err) {
    console.error('[postJob] Failed to save Reel post result to history:', err.message);
    return result;
  }
}

function describeError(err) {
  // Standard Graph API error shape: { error: { message, type, code } }
  if (err.response?.data?.error) {
    return err.response.data.error.message || JSON.stringify(err.response.data.error);
  }

  // rupload.facebook.com (video upload) uses a DIFFERENT error shape:
  // { debug_info: { message: "<a JSON string itself>" } }, so it needs a
  // second parse to get to the actual human-readable reason.
  const debugMessage = err.response?.data?.debug_info?.message;
  if (debugMessage) {
    try {
      const parsed = JSON.parse(debugMessage);
      const innerMessage = parsed?.error?.message;
      if (innerMessage) return innerMessage;
    } catch {
      // Not JSON after all — fall through and just use it as-is.
    }
    return debugMessage;
  }

  // Last resort: dump whatever the response body actually was.
  if (err.response?.data) {
    return JSON.stringify(err.response.data);
  }

  return err.message;
}

module.exports = { runDailyPost, runGiveawayPost, runReelPost };