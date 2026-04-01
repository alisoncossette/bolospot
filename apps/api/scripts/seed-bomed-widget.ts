import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('🏥 Seeding BoMed widget...\n');

  // 1. Upsert the BoMed widget
  const widget = await prisma.widget.upsert({
    where: { slug: 'bomed' },
    update: {
      name: 'BoMed Patient Portal',
      description: 'Healthcare permissions for PT practices and medical providers',
      icon: '🏥',
      scopes: [
        'demographics:read',
        'insurance:read',
        'appointments:read',
        'appointments:write',
        'records:read',
      ],
      isActive: true,
    },
    create: {
      slug: 'bomed',
      name: 'BoMed Patient Portal',
      description: 'Healthcare permissions for PT practices and medical providers',
      icon: '🏥',
      scopes: [
        'demographics:read',
        'insurance:read',
        'appointments:read',
        'appointments:write',
        'records:read',
      ],
      isActive: true,
    },
  });

  console.log('✅ Widget created/updated:');
  console.log(`   ID: ${widget.id}`);
  console.log(`   Slug: ${widget.slug}`);
  console.log(`   Name: ${widget.name}`);
  console.log(`   Scopes: ${widget.scopes.join(', ')}\n`);

  // 2. Check if a widget API key already exists for 'bomed'
  const existingKey = await prisma.apiKey.findFirst({
    where: {
      keyType: 'widget',
      widgetSlug: 'bomed',
      isActive: true,
    },
  });

  if (existingKey) {
    console.log('⚠️  Widget API key already exists:');
    console.log(`   ID: ${existingKey.id}`);
    console.log(`   Name: ${existingKey.name}`);
    console.log(`   Created: ${existingKey.createdAt}`);
    console.log('\n❌ Skipping key generation. Revoke the existing key first if you need a new one.\n');
    return;
  }

  // 3. Find or use the first superadmin user as the owner
  let owner = await prisma.user.findFirst({
    where: { isSuperAdmin: true },
    orderBy: { createdAt: 'asc' },
  });

  if (!owner) {
    // Fallback to any user if no superadmin exists
    owner = await prisma.user.findFirst({
      orderBy: { createdAt: 'asc' },
    });
  }

  if (!owner) {
    throw new Error('❌ No users found in database. Please create at least one user first.');
  }

  console.log(`👤 Using user as key owner: ${owner.email} (${owner.handle})\n`);

  // 4. Generate the API key
  const randomBytes = crypto.randomBytes(32).toString('hex');
  const apiKey = `bolo_widget_live_${randomBytes}`;
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const keyPrefix = apiKey.substring(0, 16); // "bolo_widget_live"

  // 5. Create the API key record
  const newApiKey = await prisma.apiKey.create({
    data: {
      userId: owner.id,
      name: 'BoMed Widget Key',
      keyHash,
      keyPrefix,
      keyType: 'widget',
      widgetSlug: 'bomed',
      permissions: [
        'demographics:read',
        'insurance:read',
        'appointments:read',
        'appointments:write',
        'records:read',
      ],
      isActive: true,
    },
  });

  console.log('✅ Widget API key created:');
  console.log(`   ID: ${newApiKey.id}`);
  console.log(`   Name: ${newApiKey.name}`);
  console.log(`   Type: ${newApiKey.keyType}`);
  console.log(`   Widget: ${newApiKey.widgetSlug}`);
  console.log(`   Permissions: ${newApiKey.permissions.join(', ')}\n`);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔑 COPY THIS API KEY (it will not be shown again):');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\n   BOLO_API_KEY=${apiKey}\n`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main()
  .catch((error) => {
    console.error('❌ Error seeding BoMed widget:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
