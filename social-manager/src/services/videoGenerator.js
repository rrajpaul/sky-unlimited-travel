const path = require('path');
const fs = require('fs/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const { config } = require('../config');
const { pickRandomMusic } = require('./musicLibrary');

const execFileAsync = promisify(execFile);

// Reels are vertical, unlike the 1080x1080 square used for feed images.
const WIDTH = 1080;
const HEIGHT = 1920;
const DURATION_SECONDS = 6; // within Meta's allowed 3–90s range for both platforms
const FPS = 30;

// When picking where in a music track to start the clip, skip the first
// and last 10% — tracks often open/close with silence, a fade, or a
// sparse intro, and landing the random offset there risks a near-silent
// 6 seconds instead of something audibly "there's music playing".
const MUSIC_START_RANGE = [0.10, 0.90];
const MUSIC_FADE_SECONDS = 0.5;

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Word-wraps text into lines that fit roughly `maxCharsPerLine` characters
 * (same approach as imageGenerator.js's wrapText — duplicated rather than
 * shared, since pulling in the whole other module here for one helper
 * isn't worth the coupling).
 */
function wrapText(text, maxCharsPerLine) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Renders the same kind of headline + scrim + brand-name overlay used on
 * the static photo cards (see imageGenerator.js's generatePhotoCard), but
 * as a standalone transparent PNG sized for video (1080x1920) rather than
 * composited directly onto a photo. FFmpeg overlays this on top of the
 * animated (zoomed/panned) video frames — pre-rendering the text as an
 * image and letting FFmpeg just overlay it is far more reliable than
 * trying to get FFmpeg's own drawtext filter to wrap text and match our
 * existing fonts/styling.
 */
async function renderTextOverlayPng({ headline }) {
  const lines = wrapText(headline, 24);
  const lineHeight = 64;
  const scrimHeight = 340 + lines.length * lineHeight;
  const textStartY = HEIGHT - scrimHeight + 120;

  const tspans = lines
    .map(
      (line, i) =>
        `<tspan x="70" y="${textStartY + i * lineHeight}">${escapeXml(line)}</tspan>`
    )
    .join('');

  const svg = `
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="scrim" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="rgba(0,0,0,0)" />
      <stop offset="100%" stop-color="rgba(0,0,0,0.80)" />
    </linearGradient>
  </defs>
  <rect x="0" y="${HEIGHT - scrimHeight}" width="${WIDTH}" height="${scrimHeight}" fill="url(#scrim)" />
  <text
    font-family="Georgia, 'Times New Roman', serif"
    font-size="54"
    font-weight="600"
    fill="#ffffff"
  >${tspans}</text>
  <text
    x="70"
    y="${HEIGHT - 80}"
    font-family="Arial, Helvetica, sans-serif"
    font-size="32"
    letter-spacing="2"
    fill="rgba(255,255,255,0.85)"
  >${escapeXml(config.brand.name.toUpperCase())}</text>
</svg>`.trim();

  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Returns the duration (in seconds) of a media file via ffprobe, or null
 * if it can't be determined (e.g. a corrupt file) — callers should treat
 * null as "don't trust this track, fall back to silent" rather than
 * crashing the whole Reel over one bad music file.
 */
async function getMediaDuration(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    const seconds = parseFloat(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

/**
 * Picks a random background track and a random start offset within it
 * (avoiding the first/last 10%, see MUSIC_START_RANGE), long enough to
 * cover DURATION_SECONDS. Returns null if there's no usable music — either
 * the library is empty, or the one track picked turns out to be too short
 * or unreadable; callers fall back to silent audio in that case rather
 * than failing the whole Reel over a music problem.
 */
async function pickMusicClip() {
  const trackPath = await pickRandomMusic();
  if (!trackPath) return null;

  const duration = await getMediaDuration(trackPath);
  if (!duration || duration < DURATION_SECONDS + 2) {
    // Too short to safely take a 6s clip with room for the start-offset
    // range below — just skip music for this Reel rather than risk
    // ffmpeg reading past the end of the file.
    return null;
  }

  const [rangeStart, rangeEnd] = MUSIC_START_RANGE;
  const latestStart = duration * rangeEnd - DURATION_SECONDS;
  const earliestStart = duration * rangeStart;
  const startOffset = earliestStart + Math.random() * Math.max(0, latestStart - earliestStart);

  return { trackPath, startOffset };
}

/**
 * Renders a short (default 6s) vertical Reel from ONE real photo: a slow
 * Ken Burns zoom on the still image, with the headline + brand name
 * overlaid (matching the look of the static photo cards), and a music
 * track muxed in — a random 6-second clip (with a short fade in/out) from
 * a randomly chosen track in assets/music/, or silent audio if no music is
 * available (an empty folder, or the one track picked turning out to be
 * too short/unreadable), so this always produces a valid file either way.
 * Silent audio (rather than no audio track at all) is deliberate even in
 * the no-music case: some platforms handle a video with zero audio
 * streams inconsistently during processing, so an explicit silent AAC
 * track is the safer fallback.
 *
 * Returns the same { filePath, publicUrl, fileName } shape the image
 * generators use, so postJob.js can treat a Reel's output the same way
 * as an image's for the parts of the pipeline that don't care which it
 * is (history logging, the public URL Meta fetches from).
 */
async function generateReelVideo({ headline, photoPath }) {
  const workDir = path.join(__dirname, '..', '..', 'public', 'previews');
  await fs.mkdir(workDir, { recursive: true });

  const id = uuidv4();
  const overlayPath = path.join(workDir, `${id}-overlay.png`);
  const outputFileName = `${id}.mp4`;
  const outputPath = path.join(workDir, outputFileName);

  // 1. Prep the source photo: force it to a size FFmpeg's zoompan filter
  // can work with predictably (oversized relative to the output so the
  // zoom has room to move without ever showing an edge), matching the
  // portrait aspect ratio Reels need rather than the square photo cards.
  const sourceForZoom = path.join(workDir, `${id}-source.jpg`);
  await sharp(photoPath)
    .resize(WIDTH * 2, HEIGHT * 2, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 90 })
    .toFile(sourceForZoom);

  // 2. Render the text overlay as its own transparent PNG.
  const overlayBuffer = await renderTextOverlayPng({ headline });
  await fs.writeFile(overlayPath, overlayBuffer);

  const totalFrames = DURATION_SECONDS * FPS;

  // 3. Pick a music clip (see pickMusicClip) — null falls back to silence.
  const musicClip = await pickMusicClip();

  // 4. Build the video with FFmpeg:
  //    - Input 0: the oversized still photo, animated with zoompan (a slow
  //      continuous zoom-in — the classic "Ken Burns" effect) down to the
  //      real output size.
  //    - Input 1: the text overlay PNG, composited on top for the whole
  //      duration.
  //    - Input 2: either a trimmed/faded clip from a real music track, or
  //      a silent audio track, decided once up front (see musicClip) so
  //      the rest of this function doesn't need two separate code paths.
  //    Encoded as H.264 + AAC, which matches both Facebook's and
  //    Instagram's documented Reels requirements.
  const filterComplex =
    `[0:v]scale=${WIDTH * 2}:${HEIGHT * 2},` +
    `zoompan=z='min(zoom+0.0008,1.15)':d=${totalFrames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}[bg];` +
    `[bg][1:v]overlay=0:0:format=auto[outv]`;

  const audioInputArgs = musicClip
    ? ['-ss', String(musicClip.startOffset), '-t', String(DURATION_SECONDS), '-i', musicClip.trackPath]
    : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000'];

  const audioFilter = musicClip
    ? [
        '-af',
        `afade=t=in:st=0:d=${MUSIC_FADE_SECONDS},afade=t=out:st=${DURATION_SECONDS - MUSIC_FADE_SECONDS}:d=${MUSIC_FADE_SECONDS}`,
      ]
    : [];

  const args = [
    '-y', // overwrite output without prompting
    '-loop', '1',
    '-i', sourceForZoom,
    '-loop', '1',
    '-i', overlayPath,
    ...audioInputArgs,
    '-filter_complex', filterComplex,
    '-map', '[outv]',
    '-map', '2:a',
    ...audioFilter,
    '-t', String(DURATION_SECONDS),
    '-r', String(FPS),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-profile:v', 'main',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '48000',
    '-shortest',
    outputPath,
  ];

  try {
    await execFileAsync('ffmpeg', args, { maxBuffer: 1024 * 1024 * 20 });
  } catch (err) {
    throw new Error(`FFmpeg failed to render the Reel: ${err.stderr || err.message}`);
  } finally {
    // Clean up the two intermediate files regardless of success/failure —
    // only the final MP4 needs to stick around to be served publicly.
    await fs.unlink(sourceForZoom).catch(() => {});
    await fs.unlink(overlayPath).catch(() => {});
  }

  const publicUrl = config.publicBaseUrl
    ? `${config.publicBaseUrl.replace(/\/$/, '')}/previews/${outputFileName}`
    : null;

  return {
    filePath: outputPath,
    publicUrl,
    fileName: outputFileName,
    sourcePhotoFile: path.basename(photoPath),
  };
}

module.exports = { generateReelVideo, WIDTH, HEIGHT, DURATION_SECONDS };