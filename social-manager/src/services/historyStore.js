const { pool } = require('../db');

// Cached so the CREATE TABLE runs at most once per process lifetime rather
// than on every single read/write — CREATE TABLE IF NOT EXISTS is safe to
// re-run, but there's no reason to pay a round trip for it every time.
let ensureTablePromise = null;

/**
 * Creates the social_post_history table if it doesn't already exist, in
 * the MAIN WEBSITE's shared Postgres database. Everything the app already
 * builds for a post result (headline, caption, items, image info,
 * facebook/instagram publish results, errors, and any post-type-specific
 * extras like a giveaway's prize fields) is stored as-is in `data` (JSONB)
 * — rather than a rigid column per field — since the shape already differs
 * between regular and giveaway posts, and is likely to keep evolving (e.g.
 * a future Reels post type). post_type, source_photo_file, and dry_run are
 * pulled out as their own indexed columns specifically because
 * /api/photo-usage and /api/history filter/sort on them; everything else
 * only ever needs to be read back whole, never queried into.
 */
function ensureTable() {
  if (!ensureTablePromise) {
    ensureTablePromise = pool.query(`
      CREATE TABLE IF NOT EXISTS social_post_history (
        id SERIAL PRIMARY KEY,
        post_type TEXT,
        source_photo_file TEXT,
        dry_run BOOLEAN NOT NULL DEFAULT false,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_social_post_history_created_at
        ON social_post_history (created_at DESC);
    `);
  }
  return ensureTablePromise;
}

/**
 * Returns the most recent post results, newest first — same shape as
 * before the Postgres move: each entry is the original result object
 * (postType, headline, caption, ..., facebook, instagram, errors) plus a
 * `timestamp` field. Capped at 500 to match the old file-based behavior
 * that callers (like /api/history's default) were already built around.
 */
async function readHistory() {
  await ensureTable();
  const { rows } = await pool.query(
    `SELECT data, created_at FROM social_post_history ORDER BY created_at DESC LIMIT 500`
  );
  return rows.map((row) => ({
    ...row.data,
    timestamp: row.created_at.toISOString(),
  }));
}

/**
 * Saves one post result. Returns the saved entry in the same shape
 * readHistory() produces (including `timestamp`), so callers that use the
 * return value (runDailyPost, runGiveawayPost) don't need to know or care
 * that storage is Postgres now rather than a JSON file.
 */
async function appendHistory(entry) {
  await ensureTable();
  const { rows } = await pool.query(
    `INSERT INTO social_post_history (post_type, source_photo_file, dry_run, data)
     VALUES ($1, $2, $3, $4)
     RETURNING data, created_at`,
    [
      entry.postType || null,
      entry.sourcePhotoFile || null,
      !!entry.dryRun,
      JSON.stringify(entry),
    ]
  );
  const row = rows[0];
  return { ...row.data, timestamp: row.created_at.toISOString() };
}

module.exports = { readHistory, appendHistory };