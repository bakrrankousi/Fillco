import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadTestEnv } from './env';

/** Recreates the test database schema from migrations and loads reference data once per run. */
export default async function setup(): Promise<void> {
  const url = loadTestEnv();
  const { PrismaClient, bootstrap } = await import('@fillco/db');
  const { DEFAULT_ROLES } = await import('@fillco/contracts');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await prisma.$executeRawUnsafe('CREATE SCHEMA public');
    execSync('npx prisma migrate deploy', {
      cwd: resolve(__dirname, '../../../packages/db'),
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });
    await bootstrap(prisma, {
      roles: DEFAULT_ROLES,
      admin: { email: 'admin@test.local', password: 'Admin-Test-2026', fullName: 'Test Admin' },
    });
  } finally {
    await prisma.$disconnect();
  }
}
