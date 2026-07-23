const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

/**
 * Optimizes a single image:
 * - Resizes if width > 1920px.
 * - Converts to WebP (quality 80%).
 * - Generates tablet (768px) and mobile (480px) responsive WebP versions.
 * - Deletes the original file to conserve storage (if it's not the optimized output).
 * 
 * @param {string} absolutePath - The absolute path of the uploaded file on disk.
 * @returns {Promise<Object>} - Relative paths to the optimized images.
 */
async function optimizeImage(absolutePath) {
  const ext = path.extname(absolutePath).toLowerCase();
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
  
  if (!allowedExtensions.includes(ext)) {
    // Not an image file (could be a video like mp4), return path unchanged
    const relativePath = '/uploads/' + path.basename(absolutePath);
    return { optimized: relativePath };
  }

  const dir = path.dirname(absolutePath);
  const baseName = path.basename(absolutePath, ext);
  
  const optimizedFileName = `${baseName}-optimized.webp`;
  const tabletFileName = `${baseName}-tablet.webp`;
  const mobileFileName = `${baseName}-mobile.webp`;

  const optimizedPath = path.join(dir, optimizedFileName);
  const tabletPath = path.join(dir, tabletFileName);
  const mobilePath = path.join(dir, mobileFileName);

  try {
    const pipeline = sharp(absolutePath);
    const metadata = await pipeline.metadata();

    // 1. Generate Main Optimized WebP (max width 1920px)
    let mainPipeline = sharp(absolutePath);
    if (metadata.width > 1920) {
      mainPipeline = mainPipeline.resize({ width: 1920, withoutEnlargement: true });
    }
    await mainPipeline
      .webp({ quality: 80 })
      .toFile(optimizedPath);

    // 2. Generate Tablet WebP (max width 768px)
    let tabletPipeline = sharp(absolutePath);
    if (metadata.width > 768) {
      tabletPipeline = tabletPipeline.resize({ width: 768, withoutEnlargement: true });
    }
    await tabletPipeline
      .webp({ quality: 80 })
      .toFile(tabletPath);

    // 3. Generate Mobile WebP (max width 480px)
    let mobilePipeline = sharp(absolutePath);
    if (metadata.width > 480) {
      mobilePipeline = mobilePipeline.resize({ width: 480, withoutEnlargement: true });
    }
    await mobilePipeline
      .webp({ quality: 80 })
      .toFile(mobilePath);

    // 4. Delete the original file to conserve storage (unless it was already the optimized file)
    if (absolutePath !== optimizedPath && fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }

    return {
      optimized: `/uploads/${optimizedFileName}`,
      tablet: `/uploads/${tabletFileName}`,
      mobile: `/uploads/${mobileFileName}`
    };
  } catch (error) {
    console.error(`Error optimizing image ${absolutePath}:`, error);
    // If sharp fails, fallback to standard path
    return { optimized: `/uploads/${path.basename(absolutePath)}` };
  }
}

module.exports = {
  optimizeImage
};
