import { PrismaClient } from '@prisma/client';
import { DEFAULT_ROLES } from '@fillco/contracts';
import { bootstrap } from '../bootstrap';
import { loadRootEnv } from '../env';

loadRootEnv();

/** Loads reference data, roles, the company and the first admin (ADMIN_EMAIL / ADMIN_PASSWORD). */
async function main() {
  const prisma = new PrismaClient();
  try {
    const email = process.env.ADMIN_EMAIL ?? 'admin@fillco.local';
    const password = process.env.ADMIN_PASSWORD;
    if (!password && process.env.NODE_ENV === 'production') throw new Error('Set ADMIN_PASSWORD');
    await bootstrap(prisma, {
      roles: DEFAULT_ROLES,
      companyName: process.env.COMPANY_NAME,
      baseCurrency: process.env.BASE_CURRENCY,
      timezone: process.env.COMPANY_TIMEZONE,
      admin: { email, password: password ?? 'ChangeMe-2026' },
    });
    console.log(`Bootstrap complete. Admin: ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
