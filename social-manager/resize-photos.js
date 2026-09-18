const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const dir = 'assets/photos';
const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp|svg)$/i.test(f));

(async () => {
  for (const file of files) {
    const inputPath = path.join(dir, file);
    const outputName = file.replace(/\.[^.]+$/, '.jpg');
    const outputPath = path.join(dir, outputName);
    const isSvg = /\.svg$/i.test(file);

    // SVGs are vector — sharp rasterizes them at whatever width/height the
    // file declares, which is often small (e.g. 100x100). `density` renders
    // at a higher effective DPI first, so the raster has enough detail
    // before it gets resized down to 1600px, instead of coming out blurry.
    const input = isSvg ? sharp(inputPath, { density: 300 }) : sharp(inputPath);

    await input
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }) // SVGs can have transparency; JPEG can't, so give it a white backing
      .jpeg({ quality: 82 })
      .toFile(outputPath + '.tmp');

    fs.renameSync(outputPath + '.tmp', outputPath);
    if (outputPath !== inputPath) fs.unlinkSync(inputPath);

    console.log('converted:', file, '->', outputName);
  }
})();
