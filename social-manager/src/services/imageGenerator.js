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

module.exports = { generateImage, THEME_GRADIENTS };
