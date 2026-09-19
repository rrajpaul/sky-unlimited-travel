const path = require('path');
const fs = require('fs/promises');

const PHOTO_DIR = path.join(__dirname, '..', '..', 'assets', 'photos');
const CURSOR_PATH = path.join(__dirname, '..', '..', 'data', 'photo-cursor.json');
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

async function readCursor() {
  try {
    const raw = await fs.readFile(CURSOR_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return { lastFilename: null };
    throw err;
  }
}

async function writeCursor(cursor) {
  await fs.mkdir(path.dirname(CURSOR_PATH), { recursive: true });
  await fs.writeFile(CURSOR_PATH, JSON.stringify(cursor, null, 2));
}

/**
 * Returns the next photo in alphabetical order after whichever one was used
 * last time, wrapping back to the start once the list is exhausted. Persists
 * progress to data/photo-cursor.json so the sequence survives process
 * restarts (e.g. a Railway redeploy) instead of resetting to the beginning
 * every time.
 *
 * If the previously-used filename no longer exists (e.g. you removed a
 * photo), this falls back to starting from the beginning — it doesn't try
 * to guess where it "would" be in the new list.
 */
async function pickNextPhoto() {
  const photos = await listPhotos();
  if (photos.length === 0) return null;

  const cursor = await readCursor();
  const filenames = photos.map((p) => path.basename(p));

  let nextIndex = 0;
  if (cursor.lastFilename) {
    const lastIndex = filenames.indexOf(cursor.lastFilename);
    if (lastIndex !== -1) {
      nextIndex = (lastIndex + 1) % photos.length;
    }
    // else: last-used photo is gone, just start from the beginning
  }

  const chosen = photos[nextIndex];
  await writeCursor({ lastFilename: path.basename(chosen) });
  return chosen;
}

module.exports = { listPhotos, pickRandomPhoto, pickNextPhoto, PHOTO_DIR };
