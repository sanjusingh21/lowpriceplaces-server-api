const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  try {
    const listings = await prisma.listing.findMany({ take: 1 });
    console.log('SUCCESS - priceMax:', listings[0]?.priceMax);
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}
test();
