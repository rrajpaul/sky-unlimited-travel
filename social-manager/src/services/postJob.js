const { generatePost } = require('./contentGenerator');
const { generateImage } = require('./imageGenerator');
const { postToFacebook } = require('./facebookService');
const { postToInstagram } = require('./instagramService');
const { appendHistory } = require('./historyStore');
const { config } = require('../config');

/**
 * Runs the full daily pipeline:
 *   1. Ask Claude for a headline + caption (quote / tip / spotlight).
 *   2. Render that into a branded square image.
 *   3. Publish the image + caption to Facebook and Instagram.
 *   4. Log the outcome (including partial failures) to history.
 *
 * `dryRun: true` generates content + image but skips actually posting —
 * useful for the /preview endpoint.
 */
async function runDailyPost({ dryRun = false } = {}) {
  const post = await generatePost();
  const image = await generateImage({
    headline: post.headline,
    theme: post.image_theme,
  });

  if (!image.publicUrl && !dryRun) {
    throw new Error(
      'PUBLIC_BASE_URL is not configured, so the generated image has no public URL for Meta to fetch. Set PUBLIC_BASE_URL in .env, or use dryRun/preview mode.'
    );
  }

  const result = {
    postType: post.postType,
    headline: post.headline,
    caption: post.caption,
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
