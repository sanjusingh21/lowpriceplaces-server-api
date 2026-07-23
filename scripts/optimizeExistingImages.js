const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs');
const { optimizeImage } = require('../utils/imageOptimizer');

const prisma = new PrismaClient();
const uploadsDir = path.join(__dirname, '..', 'uploads');

async function migratePath(relativeOrAbsolutePath) {
  if (!relativeOrAbsolutePath || relativeOrAbsolutePath.startsWith('http')) {
    return relativeOrAbsolutePath;
  }

  // Already optimized
  if (relativeOrAbsolutePath.endsWith('-optimized.webp')) {
    return relativeOrAbsolutePath;
  }

  const fileName = path.basename(relativeOrAbsolutePath);
  const absoluteDiskPath = path.join(uploadsDir, fileName);

  if (fs.existsSync(absoluteDiskPath)) {
    console.log(`Optimizing file: ${fileName}...`);
    const result = await optimizeImage(absoluteDiskPath);
    return result.optimized;
  } else {
    console.log(`File not found on disk, skipping: ${fileName}`);
    return relativeOrAbsolutePath;
  }
}

async function migrateListingImages() {
  console.log('Migrating Listing images...');
  const listings = await prisma.listing.findMany({});
  for (const listing of listings) {
    if (!listing.imagePath) continue;
    const paths = listing.imagePath.split(',');
    const updatedPaths = [];
    for (const p of paths) {
      if (p) {
        const optimized = await migratePath(p);
        updatedPaths.push(optimized);
      }
    }
    const newImagePath = updatedPaths.join(',');
    if (newImagePath !== listing.imagePath) {
      await prisma.listing.update({
        where: { id: listing.id },
        data: { imagePath: newImagePath }
      });
      console.log(`Updated Listing LPP-${String(listing.id).padStart(5, '0')} to WebP paths.`);
    }
  }
}

async function migrateStoreImages() {
  console.log('Migrating Store images...');
  const stores = await prisma.store.findMany({});
  for (const store of stores) {
    if (!store.imagePath) continue;
    const optimized = await migratePath(store.imagePath);
    if (optimized !== store.imagePath) {
      await prisma.store.update({
        where: { id: store.id },
        data: { imagePath: optimized }
      });
      console.log(`Updated Store #${store.id} (${store.name}) image to WebP.`);
    }
  }
}

async function migrateServiceImages() {
  console.log('Migrating Service images...');
  const services = await prisma.service.findMany({});
  for (const service of services) {
    if (!service.imagePath) continue;
    const optimized = await migratePath(service.imagePath);
    if (optimized !== service.imagePath) {
      await prisma.service.update({
        where: { id: service.id },
        data: { imagePath: optimized }
      });
      console.log(`Updated Service #${service.id} (${service.name}) image to WebP.`);
    }
  }
}

async function migrateCategoryImages() {
  console.log('Migrating Category images...');
  const categories = await prisma.category.findMany({});
  for (const category of categories) {
    if (!category.imagePath) continue;
    const optimized = await migratePath(category.imagePath);
    if (optimized !== category.imagePath) {
      await prisma.category.update({
        where: { id: category.id },
        data: { imagePath: optimized }
      });
      console.log(`Updated Category #${category.id} (${category.name}) image to WebP.`);
    }
  }
}

async function migrateCityImages() {
  console.log('Migrating City images...');
  const cities = await prisma.city.findMany({});
  for (const city of cities) {
    if (!city.imagePath) continue;
    const optimized = await migratePath(city.imagePath);
    if (optimized !== city.imagePath) {
      await prisma.city.update({
        where: { id: city.id },
        data: { imagePath: optimized }
      });
      console.log(`Updated City #${city.id} (${city.name}) image to WebP.`);
    }
  }
}

async function main() {
  try {
    await migrateListingImages();
    await migrateStoreImages();
    await migrateServiceImages();
    await migrateCategoryImages();
    await migrateCityImages();
    console.log('Database image optimization migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
