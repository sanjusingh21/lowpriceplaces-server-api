const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  try {
    // Check columns exist
    const cols = await prisma.$queryRaw`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Listing'
      ORDER BY column_name
    `;
    console.log('Listing columns on Railway:');
    cols.forEach(c => console.log(' -', c.column_name));

    // Check listing count
    const count = await prisma.listing.count();
    console.log('\nTotal listings on Railway:', count);

    // Check a listing with priceMax
    const sample = await prisma.listing.findFirst({ select: { id: true, title: true, priceMax: true, listingType: true } });
    console.log('\nSample listing:', JSON.stringify(sample, null, 2));
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}
test();
