import { prisma } from '../src/db/prisma.js';

async function main() {
  console.log('Connecting to Prisma...');
  const count = await prisma.userProfile.count();
  console.log('Success! UserProfile count:', count);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Prisma connection error:', err);
  process.exit(1);
});
