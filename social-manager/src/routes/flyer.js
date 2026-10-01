const path = require('path');
const fs = require('fs/promises');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const { config } = require('../config');
const { postToFacebook } = require('../services/facebookService');
const { postToInstagram } = require('../services/instagramService');
const { appendHistory } = require('../services/historyStore');

const router = express.Router();

// --- Access protection -----------------------------------------------
// This page lets anyone who can reach it post directly to the real
// Facebook Page and Instagram account — unlike the rest of this app's
// API, which needs curl/a terminal to use, a web form is the kind of
// thing that gets bookmarked or forwarded by accident. Simple HTTP Basic
// Auth (the browser's own built-in login prompt, no custom login page to
// build) is enough to stop a leaked link from being usable by anyone who
// finds it, without adding real user-management complexity for what's a
// single-person tool.
function requireFlyerAuth(req, res, next) {
  const expectedUser = config.flyerUploadUser;
  const expectedPass = config.flyerUploadPassword;

  if (!expectedUser || !expectedPass) {
    return res.status(500).send('Flyer upload is not configured (missing FLYER_UPLOAD_USER / FLYER_UPLOAD_PASSWORD).');
  }

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString('utf-8').split(':');
    if (user === expectedUser && pass === expectedPass) {
      return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Flyer Upload"');
  return res.status(401).send('Authentication required.');
}

router.use(requireFlyerAuth);

// --- File upload handling ---------------------------------------------
// Stored in memory (not disk) since the file is small (flyers aren't
// 186-photo-library-sized assets) and immediately re-encoded through
// sharp below — no need for an intermediate temp file on disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB — generous for a flyer image, not unlimited
});

const ALLOWED_MIMETYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Instagram's documented safe aspect-ratio range for feed photos — Facebook
// is generally more lenient, but Instagram is the stricter of the two, so
// matching its range keeps a single flyer working cleanly on both. Ratio is
// width/height: 0.8 = 4:5 (portrait limit), 1.91 = landscape limit.
const MIN_ASPECT_RATIO = 4 / 5;
const MAX_ASPECT_RATIO = 1.91;

/**
 * Center-crops an image buffer to bring it within [MIN_ASPECT_RATIO,
 * MAX_ASPECT_RATIO] if it's currently outside that range — cropping only
 * the minimum needed to reach the nearest edge of the safe range (not
 * forcing a specific ratio like 1:1), so a flyer that's only slightly too
 * tall/wide loses as little as possible. Returns both the (possibly
 * unchanged) buffer and a `cropped` flag + description, so the caller can
 * tell the uploader what happened rather than silently altering their
 * image.
 */
async function cropToSafeAspectRatio(buffer) {
  const { width, height } = await sharp(buffer).metadata();
  const ratio = width / height;

  if (ratio >= MIN_ASPECT_RATIO && ratio <= MAX_ASPECT_RATIO) {
    return { buffer, cropped: false };
  }

  let targetWidth = width;
  let targetHeight = height;

  if (ratio < MIN_ASPECT_RATIO) {
    // Too tall/narrow — crop height down to the portrait limit.
    targetHeight = Math.round(width / MIN_ASPECT_RATIO);
  } else {
    // Too wide — crop width down to the landscape limit.
    targetWidth = Math.round(height * MAX_ASPECT_RATIO);
  }

  const left = Math.round((width - targetWidth) / 2);
  const top = Math.round((height - targetHeight) / 2);

  const croppedBuffer = await sharp(buffer)
    .extract({ left, top, width: targetWidth, height: targetHeight })
    .toBuffer();

  return {
    buffer: croppedBuffer,
    cropped: true,
    description: `Cropped from ${width}×${height} to ${targetWidth}×${targetHeight} to fit Instagram's recommended range (between 4:5 portrait and 1.91:1 landscape).`,
  };
}

// --- The upload form page -----------------------------------------------
router.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Post a Flyer — ${config.brand.name}</title>
<style>
  body { font-family: -apple-system, Arial, sans-serif; max-width: 480px; margin: 40px auto; padding: 0 20px; color: #1a2947; }
  h1 { font-size: 22px; }
  label { display: block; margin-top: 16px; font-weight: 600; font-size: 14px; }
  input[type="file"], textarea { width: 100%; box-sizing: border-box; margin-top: 6px; padding: 10px; border: 1px solid #ccc; border-radius: 6px; font-size: 15px; }
  textarea { min-height: 100px; font-family: inherit; resize: vertical; }
  button { margin-top: 20px; width: 100%; padding: 14px; background: #1a2947; color: white; border: none; border-radius: 6px; font-size: 16px; font-weight: 600; cursor: pointer; }
  button:disabled { background: #94a3b8; cursor: not-allowed; }
  #status { margin-top: 16px; padding: 12px; border-radius: 6px; font-size: 14px; white-space: pre-wrap; display: none; }
  #status.success { display: block; background: #dcfce7; color: #166534; }
  #status.error { display: block; background: #fee2e2; color: #991b1b; }
  #status.warning { display: block; background: #fef3c7; color: #92400e; }
  #dimensionHint { margin-top: 8px; font-size: 13px; color: #92400e; display: none; }
  #preview { margin-top: 16px; max-width: 100%; border-radius: 6px; display: none; }
</style>
</head>
<body>
  <h1>Post a Flyer</h1>
  <p style="color:#6b7280; font-size:14px;">Uploads directly to Facebook and Instagram immediately — there's no preview/undo step.</p>

  <form id="flyerForm">
    <label for="image">Flyer image</label>
    <input type="file" id="image" name="image" accept="image/jpeg,image/png,image/webp" required>
    <div id="dimensionHint"></div>
    <img id="preview" alt="">

    <label for="caption">Caption</label>
    <textarea id="caption" name="caption" placeholder="Write the caption for this post..." required></textarea>

    <button type="submit" id="submitBtn">Post to Facebook &amp; Instagram</button>
  </form>

  <div id="status"></div>

  <script>
    const form = document.getElementById('flyerForm');
    const statusEl = document.getElementById('status');
    const submitBtn = document.getElementById('submitBtn');
    const imageInput = document.getElementById('image');
    const preview = document.getElementById('preview');

    const dimensionHint = document.getElementById('dimensionHint');
    const MIN_RATIO = 4 / 5;
    const MAX_RATIO = 1.91;

    imageInput.addEventListener('change', () => {
      const file = imageInput.files[0];
      if (!file) return;

      const url = URL.createObjectURL(file);
      preview.src = url;
      preview.style.display = 'block';

      // Instant client-side check, purely informational — the server does
      // the actual crop regardless, this just lets Tasha know ahead of the
      // upload round-trip rather than finding out only after submitting.
      const img = new Image();
      img.onload = () => {
        const ratio = img.naturalWidth / img.naturalHeight;
        if (ratio < MIN_RATIO || ratio > MAX_RATIO) {
          dimensionHint.textContent = "⚠ This image (" + img.naturalWidth + "×" + img.naturalHeight + ") is outside Instagram's recommended range and will be automatically center-cropped when you post.";
          dimensionHint.style.display = 'block';
        } else {
          dimensionHint.style.display = 'none';
        }
      };
      img.src = url;
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      statusEl.className = '';
      statusEl.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Posting...';

      const formData = new FormData();
      formData.append('image', imageInput.files[0]);
      formData.append('caption', document.getElementById('caption').value);

      try {
        const res = await fetch('post', { method: 'POST', body: formData });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Something went wrong.');

        const fbOk = data.facebook && !data.errors.some(e => e.platform === 'facebook');
        const igOk = data.instagram && !data.errors.some(e => e.platform === 'instagram');

        let message = '';
        if (data.cropWarning) message += '✂ ' + data.cropWarning + '\\n\\n';
        if (fbOk) message += '✓ Posted to Facebook\\n';
        else message += '✗ Facebook failed: ' + (data.errors.find(e => e.platform === 'facebook')?.message || 'unknown error') + '\\n';
        if (igOk) message += '✓ Posted to Instagram';
        else message += '✗ Instagram failed: ' + (data.errors.find(e => e.platform === 'instagram')?.message || 'unknown error');

        statusEl.textContent = message;
        statusEl.className = (fbOk && igOk) ? (data.cropWarning ? 'warning' : 'success') : 'error';

        if (fbOk && igOk) {
          form.reset();
          preview.style.display = 'none';
          dimensionHint.style.display = 'none';
        }
      } catch (err) {
        statusEl.textContent = 'Failed: ' + err.message;
        statusEl.className = 'error';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Post to Facebook & Instagram';
      }
    });
  </script>
</body>
</html>`);
});

// --- The actual upload + post endpoint ---------------------------------
router.post('/post', upload.single('image'), async (req, res) => {
  const file = req.file;
  const caption = (req.body.caption || '').trim();

  if (!file) {
    return res.status(400).json({ error: 'No image file was uploaded.' });
  }
  if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
    return res.status(400).json({
      error: `Unsupported image type: ${file.mimetype}. Please upload a JPEG, PNG, or WebP file (not HEIC/HEIF — convert it first if it's an iPhone photo).`,
    });
  }
  if (!caption) {
    return res.status(400).json({ error: 'Caption is required.' });
  }

  let imageFile, imagePublicUrl, cropWarning = null;
  try {
    // Crop first (if needed) at full original resolution, THEN re-encode —
    // cropping after the resize-to-2048 step would mean working from an
    // already-downscaled image for no reason.
    const { buffer: workingBuffer, cropped, description } = await cropToSafeAspectRatio(file.buffer);
    if (cropped) cropWarning = description;

    // Re-encode through sharp regardless of input format — guarantees a
    // clean, standard JPEG reaches Meta's fetchers rather than whatever
    // the uploader's phone/camera/design tool happened to produce, and
    // strips any embedded metadata (location EXIF data, etc.) along the
    // way as a side effect of the re-encode.
    const fileName = `${uuidv4()}.jpg`;
    const dir = path.join(__dirname, '..', '..', 'public', 'previews');
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, fileName);

    await sharp(workingBuffer)
      .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toFile(filePath);

    imageFile = fileName;
    imagePublicUrl = config.publicBaseUrl
      ? `${config.publicBaseUrl.replace(/\/$/, '')}/previews/${fileName}`
      : null;
  } catch (err) {
    return res.status(400).json({ error: `Could not process the uploaded image: ${err.message}` });
  }

  if (!imagePublicUrl) {
    return res.status(500).json({
      error: 'PUBLIC_BASE_URL is not configured, so the uploaded image has no public URL for Meta to fetch.',
    });
  }

  const result = {
    postType: 'flyer',
    caption,
    imageFile,
    imagePublicUrl,
    cropWarning, // null if no crop was needed
    dryRun: false,
    facebook: null,
    instagram: null,
    errors: [],
  };

  try {
    result.facebook = await postToFacebook({ imageUrl: imagePublicUrl, caption });
  } catch (err) {
    result.errors.push({ platform: 'facebook', message: describeError(err) });
  }

  try {
    result.instagram = await postToInstagram({ imageUrl: imagePublicUrl, caption });
  } catch (err) {
    result.errors.push({ platform: 'instagram', message: describeError(err) });
  }

  try {
    const logged = await appendHistory(result);
    return res.json(logged);
  } catch (err) {
    console.error('[flyer] Failed to save flyer post result to history:', err.message);
    return res.json(result);
  }
});

function describeError(err) {
  if (err.response?.data?.error) {
    return err.response.data.error.message || JSON.stringify(err.response.data.error);
  }
  if (err.response?.data) {
    return JSON.stringify(err.response.data);
  }
  return err.message;
}

module.exports = router;