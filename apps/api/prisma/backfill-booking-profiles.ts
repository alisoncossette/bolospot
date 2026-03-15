/**
 * Backfill script: creates a default BookingProfile for existing users who don't have one.
 *
 * Run with: npx ts-node apps/api/prisma/backfill-booking-profiles.ts
 * Or via: pnpm --filter api ts-node prisma/backfill-booking-profiles.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Find users without any booking profile
  const usersWithoutProfile = await prisma.user.findMany({
    where: {
      bookingProfiles: { none: {} },
    },
    select: { id: true, handle: true, name: true },
  });

  console.log(`Found ${usersWithoutProfile.length} users without a BookingProfile`);

  for (const user of usersWithoutProfile) {
    await prisma.bookingProfile.create({
      data: {
        userId: user.id,
        slug: 'default',
        name: `Meet with ${user.name || user.handle}`,
        durations: [15, 30, 60],
        customDays: [],
        isActive: true,
        visibility: 'PUBLIC',
      },
    });
    console.log(`  Created BookingProfile for @${user.handle}`);
  }

  console.log('Done!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
