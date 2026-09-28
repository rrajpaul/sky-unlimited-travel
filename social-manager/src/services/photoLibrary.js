const path = require('path');
const fs = require('fs/promises');
const { pool } = require('../db');

const PHOTO_DIR = path.join(__dirname, '..', '..', 'assets', 'photos');
const VALID_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/**
 * Lists usable photo files in assets/photos, sorted alphabetically by
 * filename. Alphabetical (not file timestamp) is deliberate: once deployed,
 * git checkouts typically give every file the same modification time, so
 * sorting by mtime would be meaningless in production — filename order is
 * the only ordering that's actually stable and deterministic there.
 *
 * Returns an empty array if the folder doesn't exist yet or has nothing in
 * it — callers should treat that as "no photos available yet" rather than
 * an error, since the library is expected to start empty and get populated
 * later.
 */
async function listPhotos() {
  try {
    const entries = await fs.readdir(PHOTO_DIR);
    return entries
      .filter((name) => VALID_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .sort((a, b) => a.localeCompare(b))
      .map((name) => path.join(PHOTO_DIR, name));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Returns a random photo's full path, or null if the library is empty.
 * Kept available as an alternative to pickNextPhoto below, in case random
 * selection is ever wanted again.
 */
async function pickRandomPhoto() {
  const photos = await listPhotos();
  if (photos.length === 0) return null;
  return photos[Math.floor(Math.random() * photos.length)];
}

// --- Cursor storage (Postgres, shared with the main website's database —
// see src/db.js) -------------------------------------------------------
//
// This used to be a local JSON file (data/photo-cursor.json). That doesn't
// survive Railway rebuilding the container from scratch (as opposed to an
// in-place restart) — every such redeploy silently reset rotation back to
// the first photo alphabetically, which is exactly the kind of "why did
// the same photo post twice" bug this whole feature exists to prevent. A
// small table in the same database already used for post history fixes
// that: it survives redeploys the same way history now does.

let ensureCursorTablePromise = null;

function ensureCursorTable() {
  if (!ensureCursorTablePromise) {
    ensureCursorTablePromise = pool.query(`
      CREATE TABLE IF NOT EXISTS photo_cursor (
        cursor_key TEXT PRIMARY KEY,
        last_filename TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }
  return ensureCursorTablePromise;
}

const CURSOR_KEY = '__all__'; // room for more than one cursor later without a schema change

async function readCursorFilename() {
  await ensureCursorTable();
  const { rows } = await pool.query(
    'SELECT last_filename FROM photo_cursor WHERE cursor_key = $1',
    [CURSOR_KEY]
  );
  return rows[0]?.last_filename || null;
}

async function writeCursorFilename(filename) {
  await ensureCursorTable();
  await pool.query(
    `INSERT INTO photo_cursor (cursor_key, last_filename, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (cursor_key) DO UPDATE SET last_filename = $2, updated_at = NOW()`,
    [CURSOR_KEY, filename]
  );
}

/**
 * Returns the filename (not full path) of the photo used in the most
 * recent REAL (non-dry-run) post, or null if there isn't one yet. Reads
 * social_post_history directly (rather than going through historyStore's
 * readHistory, which returns full JSONB payloads) since only this one
 * indexed column is actually needed here.
 *
 * Deliberately tolerant of the table not existing yet (Postgres error code
 * 42P01, undefined_table) rather than requiring historyStore to have run
 * first: photo selection happens BEFORE the history write in the normal
 * post pipeline, so on the very first post ever made, this can genuinely
 * run before social_post_history has been created — that's correctly "no
 * history yet" (null), not a real error.
 */
async function getLastUsedPhotoFilename() {
  try {
    const { rows } = await pool.query(
      `SELECT source_photo_file FROM social_post_history
       WHERE dry_run = false AND source_photo_file IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`
    );
    return rows[0]?.source_photo_file || null;
  } catch (err) {
    if (err.code === '42P01') return null; // table doesn't exist yet
    throw err;
  }
}

/**
 * Returns the next photo in alphabetical order after whichever one was used
 * last time, wrapping back to the start once the list is exhausted. The
 * cursor persists in Postgres (see above) so the sequence survives a
 * Railway redeploy instead of resetting to the beginning every time.
 * Deliberately theme-agnostic — every post type just gets the next photo in
 * line, so the whole library gets even use over time without needing to
 * classify what's actually in each photo.
 *
 * On top of the cursor, this also explicitly checks the photo actually used
 * in the most recent REAL post (queried fresh from history, not just
 * trusted from the cursor) and skips forward if they'd match — a direct
 * guard against repeating the immediately-previous post's image, on top of
 * (not instead of) the cursor advancing normally. Bounded to at most one
 * full pass over the library, so a 1-photo library can't loop forever.
 *
 * If the previously-used filename no longer exists (e.g. you removed a
 * photo), this falls back to starting from the beginning — it doesn't try
 * to guess where it "would" be in the new list.
 */
async function pickNextPhoto() {
  const photos = await listPhotos();
  if (photos.length === 0) return null;

  const filenames = photos.map((p) => path.basename(p));
  const cursorFilename = await readCursorFilename();

  let nextIndex = 0;
  if (cursorFilename) {
    const lastIndex = filenames.indexOf(cursorFilename);
    if (lastIndex !== -1) {
      nextIndex = (lastIndex + 1) % photos.length;
    }
    // else: last-used photo is gone, just start from the beginning
  }

  const lastRealPhoto = await getLastUsedPhotoFilename();

  // Skip forward if the cursor's pick would exactly repeat the most recent
  // real post's photo. Bounded by photos.length so this can never loop
  // forever — if the library only has one photo, a repeat is unavoidable
  // and this simply gives up rather than spinning.
  for (let attempts = 0; attempts < photos.length && filenames[nextIndex] === lastRealPhoto; attempts++) {
    nextIndex = (nextIndex + 1) % photos.length;
  }

  const chosen = photos[nextIndex];
  await writeCursorFilename(path.basename(chosen));
  return chosen;
}

module.exports = { listPhotos, pickRandomPhoto, pickNextPhoto, PHOTO_DIR };