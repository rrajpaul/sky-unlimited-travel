const path = require('path');
const fs = require('fs/promises');

const PHOTO_DIR = path.join(__dirname, '..', '..', 'assets', 'photos');
const CURSOR_PATH = path.join(__dirname, '..', '..', 'data', 'photo-cursor.json');
const VALID_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

// Keyword hints used to match a photo's filename to one of the six themes
// the AI can choose (see contentGenerator.js's image_theme values). This is
// intentionally heuristic — stock-photo filenames are inconsistent — so
// pickNextPhotoForTheme() always falls back to the full library rather than
// failing when nothing matches. The goal is "usually on-theme", not
// perfect classification; skim actual posts periodically and adjust these
// lists if a theme keeps picking odd photos.
const THEME_KEYWORDS = {
  beach: ['beach', 'shore', 'coast', 'wave', 'shellfish', 'sea'],
  mountains: ['mountain', 'canyon', 'dune', 'cliff', 'peak', 'desert', 'glacier'],
  'city-skyline': [
    'city', 'building', 'tower', 'skyline', 'street', 'urban', 'bridge',
    'opera', 'cathedral', 'castle', 'palace', 'church', 'museum', 'louvre',
    'monument', 'temple', 'mosque', 'gallery', 'moscow', 'paris', 'rome',
    'barcelona', 'prague', 'liverpool', 'dresden', 'venice',
  ],
  airplane: ['plane', 'airplane', 'flight', 'airport', 'luggage', 'suitcase', 'passport', 'backpack'],
  tropical: ['tropical', 'palm', 'maldives', 'bali', 'bora', 'island', 'paradise'],
  roadtrip: ['road', 'highway', 'vehicle', 'trolley', 'cruise', 'ship', 'journey', 'car'],
};

// Filenames matching these are eligible for EVERY theme, in addition to any
// theme-specific match above. Stock-photo filenames are often generic
// ("travel", "tourist", "vacation") rather than descriptive, so without
// this, a large share of the library would never match any theme and would
// sit unused forever once themed matching replaces plain rotation.
const GENERAL_KEYWORDS = [
  'travel', 'vacation', 'trip', 'tourist', 'tourism', 'holiday',
  'destination', 'journey', 'adventure', 'voyage', 'nature', 'view',
];

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
 * Filters the full photo list down to filenames that contain at least one
 * keyword for the given theme. If the theme is unknown or nothing matches,
 * returns the full list unfiltered — callers should always get *some*
 * candidates back (never an empty array unless the library itself is
 * empty), so a themed post never fails to render just because no photo
 * happened to match.
 */
async function listPhotosForTheme(theme) {
  const photos = await listPhotos();
  const keywords = THEME_KEYWORDS[theme];
  if (!keywords || photos.length === 0) return photos;

  const allKeywords = [...keywords, ...GENERAL_KEYWORDS];
  const matched = photos.filter((p) => {
    const name = path.basename(p).toLowerCase();
    return allKeywords.some((kw) => name.includes(kw));
  });

  return matched.length > 0 ? matched : photos;
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
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeCursor(cursor) {
  await fs.mkdir(path.dirname(CURSOR_PATH), { recursive: true });
  await fs.writeFile(CURSOR_PATH, JSON.stringify(cursor, null, 2));
}

/**
 * Photos that don't match ANY theme's keywords (including generic ones) —
 * often because the filename carries no content info at all (e.g. Pexels
 * downloads named after the photographer, like "pexels-jane-doe-123.jpg").
 * These can't be reliably classified by filename, but they shouldn't sit
 * unused forever just because of that — see pickNextPhotoForTheme.
 */
async function listOrphanPhotos() {
  const photos = await listPhotos();
  const themes = Object.keys(THEME_KEYWORDS);
  const matchedAnywhere = new Set();

  for (const theme of themes) {
    const matches = await listPhotosForTheme(theme);
    // listPhotosForTheme falls back to the FULL list when a theme has zero
    // matches, which would wrongly mark everything as "matched" here — so
    // only count it if the match was genuinely keyword-based, i.e. smaller
    // than the full library (or the library is small enough that a full
    // match is plausible anyway).
    if (matches.length < photos.length) {
      matches.forEach((p) => matchedAnywhere.add(p));
    }
  }

  return photos.filter((p) => !matchedAnywhere.has(p));
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
  return pickNextPhotoForTheme(null);
}

// Chance of pulling from the orphan pool (photos matching no theme) instead
// of the theme-matched pool, when picking a themed photo. Keeps those
// photos in rotation — rather than never appearing — while still favoring
// on-theme matches most of the time.
const ORPHAN_POOL_PROBABILITY = 0.15;

/**
 * Same rotation behavior as pickNextPhoto, but scoped to photos matching
 * the given theme (see listPhotosForTheme) MOST of the time. A small
 * percentage of picks instead come from the orphan pool (photos that don't
 * match any theme's keywords), so that pool still cycles through over time
 * instead of sitting permanently unused. Each pool (each theme, plus the
 * shared orphan pool) gets its own cursor position in
 * data/photo-cursor.json, so they rotate independently.
 */
async function pickNextPhotoForTheme(theme) {
  let photos;
  let cursorKey;

  if (theme) {
    const orphans = await listOrphanPhotos();
    const useOrphan = orphans.length > 0 && Math.random() < ORPHAN_POOL_PROBABILITY;
    if (useOrphan) {
      photos = orphans;
      cursorKey = '__orphans__';
    } else {
      photos = await listPhotosForTheme(theme);
      cursorKey = theme;
    }
  } else {
    photos = await listPhotos();
    cursorKey = '__all__';
  }

  if (photos.length === 0) return null;

  const cursor = await readCursor();
  const filenames = photos.map((p) => path.basename(p));

  let nextIndex = 0;
  const lastFilename = cursor[cursorKey];
  if (lastFilename) {
    const lastIndex = filenames.indexOf(lastFilename);
    if (lastIndex !== -1) {
      nextIndex = (lastIndex + 1) % photos.length;
    }
    // else: last-used photo is gone (or no longer matches this pool after a
    // library change), just start this pool's rotation over.
  }

  const chosen = photos[nextIndex];
  cursor[cursorKey] = path.basename(chosen);
  await writeCursor(cursor);
  return chosen;
}

module.exports = {
  listPhotos,
  listPhotosForTheme,
  listOrphanPhotos,
  pickRandomPhoto,
  pickNextPhoto,
  pickNextPhotoForTheme,
  PHOTO_DIR,
};