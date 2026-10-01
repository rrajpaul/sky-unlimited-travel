const path = require('path');
const fs = require('fs/promises');

const MUSIC_DIR = path.join(__dirname, '..', '..', 'assets', 'music');
const VALID_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.aac']);

/**
 * Lists usable music files in assets/music. Returns an empty array if the
 * folder doesn't exist or has nothing in it — callers should treat that as
 * "no music available, fall back to silent" rather than an error, since
 * music is optional (a Reel with no tracks loaded still works, just
 * silent, same as before this feature existed).
 */
async function listMusic() {
  try {
    const entries = await fs.readdir(MUSIC_DIR);
    return entries
      .filter((name) => VALID_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .sort((a, b) => a.localeCompare(b))
      .map((name) => path.join(MUSIC_DIR, name));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Returns a random track's full path, or null if the library is empty.
 * Deliberately simple random selection rather than the durable-rotation-
 * cursor approach photoLibrary.js uses for photos: a repeated background
 * track is far less noticeable to a viewer than a repeated photo (nobody's
 * tracking "didn't I hear this song recently" the way a visual repeat
 * stands out), so the extra infrastructure isn't worth it here.
 */
async function pickRandomMusic() {
  const tracks = await listMusic();
  if (tracks.length === 0) return null;
  return tracks[Math.floor(Math.random() * tracks.length)];
}

module.exports = { listMusic, pickRandomMusic, MUSIC_DIR };