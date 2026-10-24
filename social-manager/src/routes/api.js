const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { runDailyPost, runGiveawayPost, runReelPost } = require('../services/postJob');
const { readHistory } = require('../services/historyStore');
const { listPhotos } = require('../services/photoLibrary');
const { getActiveGiveaway } = require('../services/giveawayService');

const router = express.Router();

// Public on purpose: lets Railway (or you) confirm the server is up without
// a key. Reveals nothing but the current time.
router.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// API key protection — every route below this point requires the key.
// ---------------------------------------------------------------------------
//
// Set ADMIN_API_KEY in Railway → your service → Variables. Send it as the
// "x-api-key" header. For GET routes only (history, photos, etc.) it can
// also be passed as ?key=... so they can be opened in a browser.
//
// Fails CLOSED: if ADMIN_API_KEY isn't set, these routes refuse every
// request rather than silently becoming public again. The scheduled 11am /
// 7pm posts are unaffected either way, since the scheduler calls postJob
// directly rather than going through these URLs.

function keysMatch(provided, expected) {
  // Hash both first so the comparison is constant-time regardless of
  // length, so the key can't be guessed character by character from
  // response timing.
  const a = crypto.createHash('sha256').update(String(provided)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function requireApiKey(req, res, next) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    console.error('[routes] ADMIN_API_KEY is not set; refusing protected request to', req.path);
    return res.status(503).json({ error: 'Server is missing ADMIN_API_KEY configuration.' });
  }

  const provided = req.get('x-api-key') || (req.method === 'GET' ? req.query.key : undefined);
  if (!provided || !keysMatch(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

router.use(requireApiKey);

// How many photos are currently loaded in assets/photos, and their
// filenames — useful for confirming an upload actually landed in the right
// place before it starts getting used.
router.get('/photos', async (req, res) => {
  try {
    const photos = await listPhotos();
    res.json({
      count: photos.length,
      filenames: photos.map((p) => path.basename(p)),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generates content + image WITHOUT posting to Facebook/Instagram — lets you
// see what today's post would look like before it goes out automatically.
// An optional ?postType=... query param (travel_quote, travel_tip,
// destination_spotlight, illustration, or checklist) overrides the normal
// day-based rotation, purely for testing.
router.post('/preview', async (req, res) => {
  try {
    const { postType } = req.query;
    const result = await runDailyPost({ dryRun: true, postType });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually trigger a real post right now (in addition to the daily schedule).
router.post('/post-now', async (req, res) => {
  try {
    const { postType } = req.query;
    const result = await runDailyPost({ dryRun: false, postType });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 500);
  const history = await readHistory();
  res.json(history.slice(0, limit));
});

// Summarizes which of the real photos (see sourcePhotoFile on each history
// entry) have actually appeared in a real post, and how many times each —
// built from history, so it always matches what genuinely got posted.
// dryRun previews are excluded.
router.get('/photo-usage', async (req, res) => {
  try {
    const [allPhotos, history] = await Promise.all([listPhotos(), readHistory()]);
    const filenames = allPhotos.map((p) => path.basename(p));

    const counts = {};
    for (const entry of history) {
      if (entry.dryRun || !entry.sourcePhotoFile) continue;
      counts[entry.sourcePhotoFile] = (counts[entry.sourcePhotoFile] || 0) + 1;
    }

    const used = filenames.filter((f) => counts[f]).length;

    res.json({
      totalPhotos: filenames.length,
      usedAtLeastOnce: used,
      neverUsed: filenames.length - used,
      counts, // { filename: timesUsed } — only includes photos used at least once
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Checks whether a giveaway is currently active, without generating
// content or posting anything.
router.get('/giveaway-status', async (req, res) => {
  try {
    const giveaway = await getActiveGiveaway();
    res.json({ active: !!giveaway, giveaway });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generates a giveaway post's content + image WITHOUT posting. If no
// giveaway is currently active, returns { skipped: true }.
router.post('/giveaway-preview', async (req, res) => {
  try {
    const result = await runGiveawayPost({ dryRun: true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually trigger a real giveaway post right now — only actually posts if
// a giveaway is currently active.
router.post('/giveaway-post-now', async (req, res) => {
  try {
    const result = await runGiveawayPost({ dryRun: false });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generates a Reel (video + headline + caption) WITHOUT posting. Slower
// than /preview, since it does real FFmpeg encoding.
router.post('/reel-preview', async (req, res) => {
  try {
    const result = await runReelPost({ dryRun: true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually trigger a real Reel post right now. This posts to BOTH Facebook
// and Instagram Reels for real.
router.post('/reel-post-now', async (req, res) => {
  try {
    const result = await runReelPost({ dryRun: false });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// (The /debug-facebook-reel route was removed: it posted any caption sent
// to it and didn't validate the filename. If Facebook Reels ever need
// isolated testing again, call postReelToFacebook from a local script
// instead of exposing it on the server.)

module.exports = router;