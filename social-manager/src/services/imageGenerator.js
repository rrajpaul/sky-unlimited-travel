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
 * Renders a post to a PNG file under /public/previews and returns both the
 * local file path and the public URL Meta's Graph API can fetch it from.
 */
async function generateImage({ headline, theme }) {
  const svg = buildSvg({
    headline,
    brandName: config.brand.name,
    theme,
  });

  return renderSvgToFile(svg);
}

/**
 * Shared helper: renders an SVG string to a PNG under /public/previews and
 * returns its local path + public URL. Used by every card type below.
 */
async function renderSvgToFile(svg) {
  const fileName = `${uuidv4()}.png`;
  const dir = path.join(__dirname, '..', '..', 'public', 'previews');
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileName);

  await sharp(Buffer.from(svg)).png().toFile(filePath);

  const publicUrl = config.publicBaseUrl
    ? `${config.publicBaseUrl.replace(/\/$/, '')}/previews/${fileName}`
    : null;

  return { filePath, publicUrl, fileName };
}

/**
 * Builds the semi-transparent gradient "scrim" + headline + brand-name text
 * overlay used on top of a real photo, so white text stays legible over
 * busy image content underneath.
 */
function buildPhotoOverlaySvg({ headline, brandName }) {
  const lines = wrapText(headline, 26);
  const lineHeight = 56;
  const scrimHeight = 420; // bottom portion of the 1080px-tall image
  const scrimTop = HEIGHT - scrimHeight;
  const textStartY = HEIGHT - scrimHeight + 90;

  const tspans = lines
    .map(
      (line, i) =>
        `<tspan x="60" y="${textStartY + i * lineHeight}">${escapeXml(line)}</tspan>`
    )
    .join('');

  return `
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="scrim" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="rgba(0,0,0,0)" />
      <stop offset="100%" stop-color="rgba(0,0,0,0.82)" />
    </linearGradient>
  </defs>
  <rect x="0" y="${scrimTop}" width="${WIDTH}" height="${scrimHeight}" fill="url(#scrim)" />

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
  >${escapeXml(brandName.toUpperCase())}</text>
</svg>`.trim();
}

/**
 * Renders a post using one of the user-supplied photos as the background,
 * with the headline + brand name overlaid in a legible scrim at the bottom.
 * Caller is responsible for confirming a photo is actually available
 * (e.g. via photoLibrary.pickRandomPhoto()) before calling this.
 */
async function generatePhotoCard({ headline, photoPath }) {
  const overlaySvg = buildPhotoOverlaySvg({
    headline,
    brandName: config.brand.name,
  });

  const photoBuffer = await sharp(photoPath)
    .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'attention' })
    .toBuffer();

  const fileName = `${uuidv4()}.png`;
  const dir = path.join(__dirname, '..', '..', 'public', 'previews');
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileName);

  await sharp(photoBuffer)
    .composite([{ input: Buffer.from(overlaySvg) }])
    .png()
    .toFile(filePath);

  const publicUrl = config.publicBaseUrl
    ? `${config.publicBaseUrl.replace(/\/$/, '')}/previews/${fileName}`
    : null;

  return { filePath, publicUrl, fileName };
}

/**
 * Simple, flat-design icon "scenes" per theme — a lightweight illustration
 * rather than a photo or a plain gradient card. Deliberately basic shapes
 * (circles, paths, rects); the goal is a recognizable, on-brand graphic,
 * not fine art.
 */
function buildIllustrationScene(theme) {
  switch (theme) {
    case 'beach':
    case 'tropical':
      return `
        <circle cx="860" cy="220" r="90" fill="#fde68a" opacity="0.9" />
        <path d="M0 640 Q 270 560 540 640 T 1080 640 V 1080 H 0 Z" fill="rgba(255,255,255,0.12)" />
        <path d="M0 760 Q 270 700 540 760 T 1080 760 V 1080 H 0 Z" fill="rgba(255,255,255,0.18)" />
        <!-- palm tree -->
        <path d="M220 900 C 210 760 260 660 260 660" stroke="#1f2937" stroke-width="14" fill="none" stroke-linecap="round" />
        <path d="M260 660 C 200 630 150 640 120 610" stroke="#065f46" stroke-width="16" fill="none" stroke-linecap="round" />
        <path d="M260 660 C 210 610 200 570 190 540" stroke="#065f46" stroke-width="16" fill="none" stroke-linecap="round" />
        <path d="M260 660 C 300 610 340 590 380 570" stroke="#065f46" stroke-width="16" fill="none" stroke-linecap="round" />
        <path d="M260 660 C 320 640 360 650 400 630" stroke="#065f46" stroke-width="16" fill="none" stroke-linecap="round" />
      `;
    case 'mountains':
      return `
        <circle cx="860" cy="200" r="80" fill="#fde68a" opacity="0.85" />
        <path d="M0 780 L 220 520 L 400 700 L 560 460 L 780 720 L 1000 560 L 1080 640 V 1080 H 0 Z" fill="rgba(255,255,255,0.14)" />
        <path d="M0 860 L 260 640 L 460 820 L 700 600 L 1080 820 V 1080 H 0 Z" fill="rgba(255,255,255,0.22)" />
      `;
    case 'city-skyline':
      return `
        <circle cx="180" cy="200" r="60" fill="#fde68a" opacity="0.7" />
        ${[ [80, 520, 90, 400], [190, 460, 110, 460], [320, 560, 90, 360], [430, 400, 120, 520], [570, 500, 90, 420], [680, 440, 130, 480], [830, 560, 100, 360], [950, 480, 100, 440] ]
          .map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(255,255,255,0.16)" rx="4" />`)
          .join('')}
      `;
    case 'airplane':
      return `
        <ellipse cx="200" cy="260" rx="90" ry="40" fill="rgba(255,255,255,0.18)" />
        <ellipse cx="330" cy="220" rx="70" ry="32" fill="rgba(255,255,255,0.14)" />
        <ellipse cx="800" cy="720" rx="110" ry="46" fill="rgba(255,255,255,0.12)" />
        <g transform="translate(540 520) rotate(-25)">
          <path d="M-220 0 H180 L260 -30 L260 30 L180 0 M40 0 L-40 -90 L0 -90 L80 0 M40 0 L-40 90 L0 90 L80 0" fill="#ffffff" opacity="0.92" />
        </g>
      `;
    case 'roadtrip':
      return `
        <circle cx="860" cy="200" r="80" fill="#fde68a" opacity="0.85" />
        <path d="M0 1080 L420 500 L660 500 L1080 1080 Z" fill="rgba(255,255,255,0.12)" />
        <path d="M500 1080 L560 620 L620 620 L680 1080 Z" fill="rgba(255,255,255,0.35)" />
        <g transform="translate(300 840)">
          <rect x="0" y="0" width="260" height="90" rx="16" fill="#ffffff" opacity="0.92" />
          <rect x="30" y="-50" width="150" height="70" rx="14" fill="#ffffff" opacity="0.92" />
          <circle cx="55" cy="95" r="26" fill="#1f2937" />
          <circle cx="205" cy="95" r="26" fill="#1f2937" />
        </g>
      `;
    default:
      return '';
  }
}

/**
 * Renders a lightweight illustration-style card: theme background gradient,
 * a simple flat-design scene, a short headline, and the brand name — for
 * variety against the plain gradient/quote cards and photo cards.
 */
async function generateIllustrationCard({ headline, theme }) {
  const [colorA, colorB] = THEME_GRADIENTS[theme] || THEME_GRADIENTS.tropical;
  const lines = wrapText(headline, 24);
  const lineHeight = 58;
  const textY = 150;

  const tspans = lines
    .map(
      (line, i) =>
        `<tspan x="${WIDTH / 2}" y="${textY + i * lineHeight}">${escapeXml(line)}</tspan>`
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

  ${buildIllustrationScene(theme)}

  <text
    font-family="Georgia, 'Times New Roman', serif"
    font-size="48"
    font-weight="600"
    fill="#ffffff"
    text-anchor="middle"
  >${tspans}</text>

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

  return renderSvgToFile(svg);
}

/**
 * Renders an infographic-style checklist card: a title plus a short list of
 * items, each with a checkmark bullet. Good for "5 tips for..." style posts.
 */
async function generateChecklistCard({ title, items, theme }) {
  const [colorA, colorB] = THEME_GRADIENTS[theme] || THEME_GRADIENTS.tropical;
  const titleLines = wrapText(title, 26);
  const titleLineHeight = 52;
  const titleStartY = 130;

  const titleTspans = titleLines
    .map(
      (line, i) =>
        `<tspan x="${WIDTH / 2}" y="${titleStartY + i * titleLineHeight}">${escapeXml(line)}</tspan>`
    )
    .join('');

  const listTop = titleStartY + titleLines.length * titleLineHeight + 60;
  const rowHeight = 110;
  const maxItems = 5;
  const shownItems = (items || []).slice(0, maxItems);

  const itemsSvg = shownItems
    .map((item, i) => {
      const y = listTop + i * rowHeight;
      const wrapped = wrapText(item, 34);
      const itemTspans = wrapped
        .map((line, li) => `<tspan x="150" y="${y + li * 34}">${escapeXml(line)}</tspan>`)
        .join('');
      return `
        <circle cx="100" cy="${y - 12}" r="26" fill="rgba(255,255,255,0.18)" />
        <path d="M88 ${y - 12} L97 ${y - 3} L114 ${y - 24}" stroke="#ffffff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        <text font-family="Arial, Helvetica, sans-serif" font-size="30" fill="#ffffff">${itemTspans}</text>
      `;
    })
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

  <text
    font-family="Georgia, 'Times New Roman', serif"
    font-size="46"
    font-weight="600"
    fill="#ffffff"
    text-anchor="middle"
  >${titleTspans}</text>

  ${itemsSvg}

  <text
    x="${WIDTH / 2}"
    y="${HEIGHT - 50}"
    font-family="Arial, Helvetica, sans-serif"
    font-size="26"
    letter-spacing="2"
    fill="rgba(255,255,255,0.85)"
    text-anchor="middle"
  >${escapeXml(config.brand.name.toUpperCase())}</text>
</svg>`.trim();

  return renderSvgToFile(svg);
}

module.exports = {
  generateImage,
  generatePhotoCard,
  generateIllustrationCard,
  generateChecklistCard,
  THEME_GRADIENTS,
};
