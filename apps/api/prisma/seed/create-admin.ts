/**
 * Creates or updates an admin user.
 *
 * Deliberately a separate script rather than part of the seed: a seeded default admin
 * password is a live credential that follows the project into production and is forgotten
 * about. Passwords are always chosen deliberately, here or in the admin panel.
 *
 *   pnpm --filter @reset/api exec tsx prisma/seed/create-admin.ts owner@reset.app 'secret' OWNER
 */
import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../../src/auth/auth.service.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const [email, password, roleArg] = process.argv.slice(2);

  if (email === undefined || password === undefined) {
    console.error(
      'Usage: tsx prisma/seed/create-admin.ts <email> <password> [OWNER|MANAGER|STAFF]',
    );
    process.exitCode = 1;
    return;
  }

  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exitCode = 1;
    return;
  }

  const role = (roleArg ?? 'OWNER') as 'OWNER' | 'MANAGER' | 'STAFF';
  const store = await prisma.store.findFirst({ orderBy: { createdAt: 'asc' } });
  const passwordHash = await hashPassword(password);

  const admin = await prisma.adminUser.upsert({
    where: { email },
    update: { passwordHash, role, isActive: true },
    create: {
      email,
      passwordHash,
      name: email.split('@')[0] ?? 'Admin',
      role,
      // Owners span every outlet; managers and staff are scoped to one.
      storeId: role === 'OWNER' ? null : (store?.id ?? null),
    },
  });

  console.log(`✓ ${admin.email} — ${admin.role}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
