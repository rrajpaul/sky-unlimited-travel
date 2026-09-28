const { generatePost, generateGiveawayPost } = require('./contentGenerator');
const {
  generateImage,
  generatePhotoCard,
  generateIllustrationCard,
  generateChecklistCard,
  generateGiveawayCard,
} = require('./imageGenerator');
const { pickNextPhoto, listPhotos } = require('./photoLibrary');
const { getActiveGiveaway } = require('./giveawayService');
const { postToFacebook } = require('./facebookService');
const { postToInstagram } = require('./instagramService');
const { appendHistory } = require('./historyStore');
const { config } = require('../config');

// Chance (0-1) of using a real photo as the background for a quote/tip/
// spotlight post, when the photo library actually has photos available.
// The rest of the time, and always when the library is empty, those post
// types fall back to the plain gradient card. Set to 1 so real travel
// photos are used whenever the library has one, since the whole point of
// loading 186 real photos was to feature them prominently.
const PHOTO_CARD_PROBABILITY = 1;

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
  // the background when the library has one and the dice roll says so,
  // otherwise fall back to the original gradient card. Photos are picked in
  // alphabetical order, one after another (not randomly), so the whole
  // library gets used evenly over time rather than some photos repeating
  // while others never come up. These post types are deliberately written
  // (see contentGenerator.js) to never require a specific matching photo —
  // any travel photo works under a generic quote/tip, and
  // destination_spotlight avoids naming an exact real place — so plain
  // rotation never risks a caption/photo mismatch. The coin flip happens
  // BEFORE advancing the cursor, so a photo is only marked "used" when it's
  // actually going to be rendered — not on every call regardless of
  // outcome.
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
 *   1. Ask Claude for post content (quote / tip / spotlight / illustration
 *      / checklist — see contentGenerator for what each type returns).
 *   2. Render that into a branded square image — a gradient quote card, a
 *      real photo with a text overlay, a simple flat illustration, or a
 *      checklist/infographic card, depending on the post type.
 *   3. Publish the image + caption to Facebook and Instagram.
 *   4. Log the outcome (including partial failures) to history.
 *
 * `dryRun: true` generates content + image but skips actually posting —
 * useful for the /preview endpoint.
 */
async function runDailyPost({ dryRun = false, slot = 1, postType } = {}) {
  const post = await generatePost({ slot, postType });
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
    // Which of the real 186 photos was actually used as this post's
    // background — null for illustration/checklist/gradient posts, which
    // never draw from the photo library at all.
    sourcePhotoFile: image.sourcePhotoFile || null,
    dryRun,
    facebook: null,
    instagram: null,
    errors: [],
  };

  if (!dryRun) {
    try {
      result.facebook = await postToFacebook({
        imageUrl: image.publicUrl,
        caption: post.caption,
      });
    } catch (err) {
      result.errors.push({ platform: 'facebook', message: describeError(err) });
    }

    try {
      result.instagram = await postToInstagram({
        imageUrl: image.publicUrl,
        caption: post.caption,
      });
    } catch (err) {
      result.errors.push({ platform: 'instagram', message: describeError(err) });
    }
  }

  // A DB failure here must not erase or hide a post that may have already
  // gone out successfully above — better to return the real result (just
  // unsaved to history) and log the storage failure separately, than to
  // throw and have the caller think the whole post failed.
  try {
    return await appendHistory(result);
  } catch (err) {
    console.error('[postJob] Failed to save post result to history:', err.message);
    return result;
  }
}

/**
 * Third, independent daily post: only actually posts anything when a
 * giveaway is currently active on the main website (see
 * giveawayService.js). When there isn't one, this is a deliberate no-op —
 * it returns a `{ skipped: true }` result and does NOT write to history,
 * so history stays a record of actual posts (and real failures) rather
 * than being cluttered with "nothing to do today" entries for every day a
 * giveaway isn't running.
 *
 * `dryRun: true` still generates real content + image from whatever
 * giveaway IS currently active (for testing), but never posts — same
 * meaning as in runDailyPost.
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
    try {
      result.facebook = await postToFacebook({
        imageUrl: image.publicUrl,
        caption: post.caption,
      });
    } catch (err) {
      result.errors.push({ platform: 'facebook', message: describeError(err) });
    }

    try {
      result.instagram = await postToInstagram({
        imageUrl: image.publicUrl,
        caption: post.caption,
      });
    } catch (err) {
      result.errors.push({ platform: 'instagram', message: describeError(err) });
    }
  }

  try {
    return await appendHistory(result);
  } catch (err) {
    console.error('[postJob] Failed to save giveaway post result to history:', err.message);
    return result;
  }
}

function describeError(err) {
  // Meta's Graph API returns detailed errors under response.data.error
  if (err.response?.data?.error) {
    return err.response.data.error.message || JSON.stringify(err.response.data.error);
  }
  return err.message;
}

module.exports = { runDailyPost, runGiveawayPost };