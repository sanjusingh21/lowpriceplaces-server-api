const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const columns = await prisma.$queryRaw`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'Listing'
  `;
  
  console.log("Columns in 'Listing' table:");
  for (const col of columns) {
    console.log(`- ${col.column_name} (${col.data_type})`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
