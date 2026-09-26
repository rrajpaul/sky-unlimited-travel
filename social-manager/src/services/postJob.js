const { generatePost } = require('./contentGenerator');
const {
  generateImage,
  generatePhotoCard,
  generateIllustrationCard,
  generateChecklistCard,
} = require('./imageGenerator');
const { pickNextPhotoForTheme, listPhotosForTheme, listPhotos } = require('./photoLibrary');
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
  // otherwise fall back to the original gradient card. The photo is matched
  // to the post's image_theme (beach/mountains/city-skyline/airplane/
  // tropical/roadtrip) using filename keywords — see photoLibrary's
  // THEME_KEYWORDS — so a post about a city doesn't end up captioned over a
  // random beach photo. Each theme rotates through its own matching photos
  // in order (not randomly), so that subset gets used evenly over time. The
  // coin flip happens BEFORE advancing the cursor, so a photo is only
  // marked "used" when it's actually going to be rendered — not on every
  // call regardless of outcome.
  const photos = await listPhotos();
  const usePhoto = photos.length > 0 && Math.random() < PHOTO_CARD_PROBABILITY;

  if (usePhoto) {
    let photoPath;
    if (dryRun) {
      const candidates = await listPhotosForTheme(post.image_theme);
      photoPath = candidates[0];
    } else {
      photoPath = await pickNextPhotoForTheme(post.image_theme);
    }
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

  const logged = await appendHistory(result);
  return logged;
}

function describeError(err) {
  // Meta's Graph API returns detailed errors under response.data.error
  if (err.response?.data?.error) {
    return err.response.data.error.message || JSON.stringify(err.response.data.error);
  }
  return err.message;
}

module.exports = { runDailyPost };