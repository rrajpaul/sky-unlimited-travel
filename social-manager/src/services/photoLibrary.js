const path = require('path');
const fs = require('fs/promises');

const PHOTO_DIR = path.join(__dirname, '..', '..', 'assets', 'photos');
const VALID_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/**
 * Lists usable photo files in assets/photos. Returns an empty array if the
 * folder doesn't exist yet or has nothing in it — callers should treat that
 * as "no photos available yet" rather than an error, since the library is
 * expected to start empty and get populated later.
 */
async function listPhotos() {
  try {
    const entries = await fs.readdir(PHOTO_DIR);
    return entries
      .filter((name) => VALID_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .map((name) => path.join(PHOTO_DIR, name));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Returns a random photo's full path, or null if the library is empty.
 */
async function pickRandomPhoto() {
  const photos = await listPhotos();
  if (photos.length === 0) return null;
  return photos[Math.floor(Math.random() * photos.length)];
}

module.exports = { listPhotos, pickRandomPhoto, PHOTO_DIR };
