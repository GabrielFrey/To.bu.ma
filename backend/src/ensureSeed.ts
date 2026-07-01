import { prisma } from './db.js';
import { seed, DEMO_API_KEY } from './seed.js';

/**
 * Idempotent seed for service deployments: seeds demo data only when the
 * database is empty, so restarting the container never wipes existing data.
 */
async function main() {
  const count = await prisma.organization.count();
  if (count > 0) {
    console.log('Database already has data — skipping seed.');
  } else {
    await seed();
    console.log(`Seeded demo data. Demo API key: ${DEMO_API_KEY}`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
