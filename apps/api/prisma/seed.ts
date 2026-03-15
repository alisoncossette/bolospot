import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedIdentityTypes() {
  console.log('Seeding IdentityTypes...');

  const identityTypes = [
    {
      code: 'BOLO_HANDLE',
      name: 'Bolo Handle',
      icon: 'at-sign',
      urlPattern: null,
      sortOrder: 0,
    },
    {
      code: 'EMAIL',
      name: 'Email',
      icon: 'mail',
      urlPattern: null,
      sortOrder: 1,
    },
    {
      code: 'GOOGLE',
      name: 'Google',
      icon: 'google',
      urlPattern: null,
      sortOrder: 2,
    },
    {
      code: 'MICROSOFT',
      name: 'Microsoft',
      icon: 'microsoft',
      urlPattern: null,
      sortOrder: 3,
    },
    {
      code: 'LINKEDIN',
      name: 'LinkedIn',
      icon: 'linkedin',
      urlPattern: 'https://linkedin.com/in/{value}',
      sortOrder: 4,
    },
    {
      code: 'PHONE',
      name: 'Phone',
      icon: 'phone',
      urlPattern: null,
      sortOrder: 5,
    },
    {
      code: 'TWITTER',
      name: 'Twitter/X',
      icon: 'twitter',
      urlPattern: 'https://twitter.com/{value}',
      sortOrder: 6,
    },
    {
      code: 'INSTAGRAM',
      name: 'Instagram',
      icon: 'instagram',
      urlPattern: 'https://instagram.com/{value}',
      sortOrder: 7,
    },
    {
      code: 'GITHUB',
      name: 'GitHub',
      icon: 'github',
      urlPattern: 'https://github.com/{value}',
      sortOrder: 8,
    },
  ];

  for (const identityType of identityTypes) {
    const result = await prisma.identityType.upsert({
      where: { code: identityType.code },
      update: {
        name: identityType.name,
        icon: identityType.icon,
        urlPattern: identityType.urlPattern,
        sortOrder: identityType.sortOrder,
      },
      create: {
        code: identityType.code,
        name: identityType.name,
        icon: identityType.icon,
        urlPattern: identityType.urlPattern,
        sortOrder: identityType.sortOrder,
      },
    });
    console.log(`  Upserted IdentityType: ${result.code} (${result.name})`);
  }

  console.log('IdentityTypes seeding complete.');
}

async function main() {
  console.log('Starting database seed...\n');

  await seedIdentityTypes();

  console.log('\nDatabase seed complete!');
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
