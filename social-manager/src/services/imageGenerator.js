const path = require('path');
const fs = require('fs/promises');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const { config } = require('../config');

const WIDTH = 1080;
const HEIGHT = 1080; // square, works for both FB and IG feed posts

const THEME_GRADIENTS = {
  beach: ['#0f766e', '#0284c7'],
  mountains: ['#334155', '#0f172a'],
  'city-skyline': ['#1e1b4b', '#312e81'],
  airplane: ['#0c4a6e', '#0369a1'],
  tropical: ['#065f46', '#059669'],
  roadtrip: ['#7c2d12', '#c2410c'],
};

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Word-wraps text into lines that fit roughly `maxCharsPerLine` characters,
 * which is a simple, dependency-free way to lay text out in an SVG (SVG has
 * no built-in text wrapping).
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

function buildSvg({ headline, brandName, theme }) {
  const [colorA, colorB] = THEME_GRADIENTS[theme] || THEME_GRADIENTS.tropical;
  const lines = wrapText(headline, 22);
  const lineHeight = 68;
  const startY = HEIGHT / 2 - ((lines.length - 1) * lineHeight) / 2;

  const tspans = lines
    .map(
      (line, i) =>
        `<tspan x="${WIDTH / 2}" y="${startY + i * lineHeight}">${escapeXml(line)}</tspan>`
    )
    .join('');

  return `
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colorA}" />
      <stop offset="100%" stop-color="${colorB}" />
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" />

  <!-- subtle decorative circles -->
  <circle cx="${WIDTH - 80}" cy="90" r="140" fill="rgba(255,255,255,0.06)" />
  <circle cx="70" cy="${HEIGHT - 100}" r="180" fill="rgba(255,255,255,0.05)" />

  <text
    font-family="Georgia, 'Times New Roman', serif"
    font-size="54"
    font-weight="600"
    fill="#ffffff"
    text-anchor="middle"
  >${tspans}</text>

  <text
    x="${WIDTH / 2}"
    y="${HEIGHT - 70}"
    font-family="Arial, Helvetica, sans-serif"
    font-size="30"
    letter-spacing="2"
    fill="rgba(255,255,255,0.85)"
    text-anchor="middle"
  >${escapeXml(brandName.toUpperCase())}</text>
</svg>`.trim();
}

/**
 * Writes a sharp pipeline (already built, not yet rendered) out to
 * /public/previews as a PNG and returns both the local file path and the
 * public URL Meta's Graph API can fetch it from. Shared by every card type
 * below so they don't each re-implement file naming / public URL logic.
 */
async function finalize(sharpPipeline) {
  const fileName = `${uuidv4()}.png`;
  const dir = path.join(__dirname, '..', '..', 'public', 'previews');
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileName);

  await sharpPipeline.png().toFile(filePath);

  const publicUrl = config.publicBaseUrl
    ? `${config.publicBaseUrl.replace(/\/$/, '')}/previews/${fileName}`
    : null;

  return { filePath, publicUrl, fileName };
}

/**
 * Renders a post to a PNG file under /public/previews and returns both the
 * local file path and the public URL Meta's Graph API can fetch it from.
 */
async function generateImage({ headline, theme }) {
  const svg = buildSvg({
    headline,
    brandName: config.brand.name,
    theme,
  });

  return finalize(sharp(Buffer.from(svg)));
}

/**
 * Renders a headline over one of the user's own photos: the photo is
 * cropped to a 1080x1080 square, a dark gradient scrim is added at the
 * bottom so white text stays legible over any image, then the headline +
 * brand name are overlaid.
 */
async function generatePhotoCard({ headline, photoPath }) {
  const lines = wrapText(headline, 26);
  const lineHeight = 58;
  const scrimHeight = 220 + lines.length * lineHeight;
  const textStartY = HEIGHT - scrimHeight + 90;

  const tspans = lines
    .map(
      (line, i) =>
        `<tspan x="60" y="${textStartY + i * lineHeight}">${escapeXml(line)}</tspan>`
    )
    .join('');

  const overlaySvg = `
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="scrim" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="rgba(0,0,0,0)" />
      <stop offset="100%" stop-color="rgba(0,0,0,0.78)" />
    </linearGradient>
  </defs>
  <rect x="0" y="${HEIGHT - scrimHeight}" width="${WIDTH}" height="${scrimHeight}" fill="url(#scrim)" />
  <text
    font-family="Georgia, 'Times New Roman', serif"
    font-size="46"
    font-weight="600"
    fill="#ffffff"
  >${tspans}</text>
  <text
    x="60"
    y="${HEIGHT - 50}"
    font-family="Arial, Helvetica, sans-serif"
    font-size="26"
    letter-spacing="2"
    fill="rgba(255,255,255,0.85)"
  >${escapeXml(config.brand.name.toUpperCase())}</text>
</svg>`.trim();

  const photoBuffer = await sharp(photoPath)
    .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' })
    .toBuffer();

  const pipeline = sharp(photoBuffer).composite([
    { input: Buffer.from(overlaySvg), top: 0, left: 0 },
  ]);

  return finalize(pipeline);
}

// Very simple flat-design motifs, one per theme, drawn as plain SVG shapes
// (no external assets/icon libraries needed).
const THEME_MOTIFS = {
  beach: `<circle cx="860" cy="260" r="90" fill="rgba(255,224,130,0.9)" />
    <path d="M0,680 Q270,600 540,680 T1080,680 V1080 H0 Z" fill="rgba(255,255,255,0.10)" />`,
  mountains: `<path d="M0,760 L260,480 L440,660 L620,400 L860,700 L1080,600 V1080 H0 Z" fill="rgba(255,255,255,0.12)" />`,
  'city-skyline': `<g fill="rgba(255,255,255,0.14)">
    <rect x="120" y="560" width="100" height="360" />
    <rect x="260" y="460" width="90" height="460" />
    <rect x="400" y="600" width="80" height="320" />
    <rect x="540" y="380" width="110" height="540" />
    <rect x="700" y="520" width="90" height="400" />
    <rect x="850" y="460" width="90" height="460" />
  </g>`,
  airplane: `<g fill="rgba(255,255,255,0.16)">
    <path d="M150,540 L650,480 L900,420 L960,450 L720,540 L650,600 L520,600 L420,560 L150,600 Z" />
  </g>`,
  tropical: `<g fill="rgba(255,255,255,0.14)">
    <path d="M300,760 C260,620 340,520 420,500 C400,600 360,700 300,760 Z" />
    <path d="M300,760 C340,640 300,540 220,500 C260,600 280,700 300,760 Z" />
    <path d="M300,760 C220,700 200,600 230,520 C260,620 280,700 300,760 Z" />
    <rect x="288" y="750" width="24" height="240" />
  </g>`,
  roadtrip: `<g fill="rgba(255,255,255,0.14)">
    <rect x="0" y="760" width="1080" height="40" />
    <rect x="330" y="650" width="420" height="120" rx="16" />
    <circle cx="420" cy="790" r="45" />
    <circle cx="660" cy="790" r="45" />
  </g>`,
};

/**
 * Renders a simple flat-illustration card: gradient background, a plain
 * themed motif (palm trees, skyline, plane, etc.), and a short headline.
 * Used for the "illustration" post type, which is deliberately light and
 * graphic rather than photo-based.
 */
async function generateIllustrationCard({ headline, theme }) {
  const [colorA, colorB] = THEME_GRADIENTS[theme] || THEME_GRADIENTS.tropical;
  const motif = THEME_MOTIFS[theme] || THEME_MOTIFS.tropical;
  const lines = wrapText(headline, 20);
  const lineHeight = 62;
  const startY = 260;

  const tspans = lines
    .map(
      (line, i) =>
        `<tspan x="${WIDTH / 2}" y="${startY + i * lineHeight}">${escapeXml(line)}</tspan>`
    )
    .join('');

  const svg = `
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colorA}" />
      <stop offset="100%" stop-color="${colorB}" />
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" />
  ${motif}
  <text
    font-family="Georgia, 'Times New Roman', serif"
    font-size="56"
    font-weight="700"
    fill="#ffffff"
    text-anchor="middle"
  >${tspans}</text>
  <text
    x="${WIDTH / 2}"
    y="${HEIGHT - 70}"
    font-family="Arial, Helvetica, sans-serif"
    font-size="30"
    letter-spacing="2"
    fill="rgba(255,255,255,0.85)"
    text-anchor="middle"
  >${escapeXml(config.brand.name.toUpperCase())}</text>
</svg>`.trim();

  return finalize(sharp(Buffer.from(svg)));
}

/**
 * Renders a titled checklist card (e.g. "5 Tips for Packing Light") with a
 * short list of items, each prefixed by a checkmark bullet.
 */
async function generateChecklistCard({ title, items, theme }) {
  const [colorA, colorB] = THEME_GRADIENTS[theme] || THEME_GRADIENTS.tropical;
  const titleLines = wrapText(title, 24);
  const titleLineHeight = 56;
  const titleStartY = 140;

  const titleTspans = titleLines
    .map(
      (line, i) =>
        `<tspan x="70" y="${titleStartY + i * titleLineHeight}">${escapeXml(line)}</tspan>`
    )
    .join('');

  let itemY = titleStartY + titleLines.length * titleLineHeight + 70;
  const itemBlocks = [];
  for (const item of items.slice(0, 5)) {
    const itemLines = wrapText(item, 34);
    const itemTspans = itemLines
      .map(
        (line, i) =>
          `<tspan x="126" y="${itemY + i * 46}">${escapeXml(line)}</tspan>`
      )
      .join('');
    itemBlocks.push(`
      <circle cx="90" cy="${itemY - 16}" r="22" fill="rgba(255,255,255,0.18)" />
      <path d="M79,${itemY - 16} l8,9 l14,-18" stroke="#ffffff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      <text font-family="Arial, Helvetica, sans-serif" font-size="34" fill="#ffffff">${itemTspans}</text>`);
    itemY += itemLines.length * 46 + 40;
  }

  const svg = `
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colorA}" />
      <stop offset="100%" stop-color="${colorB}" />
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" />
  <text
    font-family="Georgia, 'Times New Roman', serif"
    font-size="50"
    font-weight="700"
    fill="#ffffff"
  >${titleTspans}</text>
  ${itemBlocks.join('')}
  <text
    x="${WIDTH / 2}"
    y="${HEIGHT - 60}"
    font-family="Arial, Helvetica, sans-serif"
    font-size="28"
    letter-spacing="2"
    fill="rgba(255,255,255,0.85)"
    text-anchor="middle"
  >${escapeXml(config.brand.name.toUpperCase())}</text>
</svg>`.trim();

  return finalize(sharp(Buffer.from(svg)));
}

/**
 * Renders a giveaway promo card: gradient background, a themed motif, the
 * headline, a prominent prize-amount + destination block, and an "ENTER
 * NOW" banner. Distinct from the other card types since accuracy of the
 * prize/destination text matters here — this is a real promotion, not
 * inspirational content — so those are laid out as their own clearly
 * separated block rather than folded into the headline.
 */
async function generateGiveawayCard({ headline, prizeLabel, destination, theme }) {
  const [colorA, colorB] = THEME_GRADIENTS[theme] || THEME_GRADIENTS.tropical;
  const motif = THEME_MOTIFS[theme] || THEME_MOTIFS.tropical;
  const lines = wrapText(headline, 20);
  const lineHeight = 58;
  const startY = 190;

  const headlineTspans = lines
    .map(
      (line, i) =>
        `<tspan x="${WIDTH / 2}" y="${startY + i * lineHeight}">${escapeXml(line)}</tspan>`
    )
    .join('');

  const prizeBlockY = startY + lines.length * lineHeight + 90;

  const svg = `
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colorA}" />
      <stop offset="100%" stop-color="${colorB}" />
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" />
  ${motif}

  <rect x="${WIDTH / 2 - 180}" y="60" width="360" height="60" rx="30" fill="rgba(255,255,255,0.16)" />
  <text
    x="${WIDTH / 2}"
    y="99"
    font-family="Arial, Helvetica, sans-serif"
    font-size="26"
    font-weight="700"
    letter-spacing="3"
    fill="#ffffff"
    text-anchor="middle"
  >GIVEAWAY</text>

  <text
    font-family="Georgia, 'Times New Roman', serif"
    font-size="52"
    font-weight="700"
    fill="#ffffff"
    text-anchor="middle"
  >${headlineTspans}</text>

  <rect x="${WIDTH / 2 - 300}" y="${prizeBlockY}" width="600" height="150" rx="16" fill="rgba(0,0,0,0.25)" />
  <text
    x="${WIDTH / 2}"
    y="${prizeBlockY + 62}"
    font-family="Georgia, 'Times New Roman', serif"
    font-size="48"
    font-weight="700"
    fill="#ffffff"
    text-anchor="middle"
  >${escapeXml(prizeLabel)}</text>
  <text
    x="${WIDTH / 2}"
    y="${prizeBlockY + 110}"
    font-family="Arial, Helvetica, sans-serif"
    font-size="30"
    fill="rgba(255,255,255,0.9)"
    text-anchor="middle"
  >to ${escapeXml(destination)}</text>

  <rect x="${WIDTH / 2 - 140}" y="${HEIGHT - 190}" width="280" height="64" rx="32" fill="#ffffff" />
  <text
    x="${WIDTH / 2}"
    y="${HEIGHT - 148}"
    font-family="Arial, Helvetica, sans-serif"
    font-size="28"
    font-weight="700"
    letter-spacing="1"
    fill="${config.brand.accentColor}"
    text-anchor="middle"
  >ENTER NOW</text>

  <text
    x="${WIDTH / 2}"
    y="${HEIGHT - 60}"
    font-family="Arial, Helvetica, sans-serif"
    font-size="28"
    letter-spacing="2"
    fill="rgba(255,255,255,0.85)"
    text-anchor="middle"
  >${escapeXml(config.brand.name.toUpperCase())}</text>
</svg>`.trim();

  return finalize(sharp(Buffer.from(svg)));
}

module.exports = {
  generateImage,
  generatePhotoCard,
  generateIllustrationCard,
  generateChecklistCard,
  generateGiveawayCard,
  THEME_GRADIENTS,
};