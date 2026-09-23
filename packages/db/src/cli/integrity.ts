import { PrismaClient } from '@prisma/client';
import { runIntegrityChecks } from '../integrity';

async function main() {
  const prisma = new PrismaClient();
  try {
    const results = await runIntegrityChecks(prisma);
    let failed = 0;
    for (const r of results) {
      const ok = r.violations === 0;
      if (!ok) failed++;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(34)} ${r.description}${ok ? '' : ` — ${r.violations} violation(s)`}`);
      if (!ok) console.log('      sample:', JSON.stringify(r.sample, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
    }
    console.log(failed === 0 ? '\nAll integrity checks passed.' : `\n${failed} check(s) failed.`);
    process.exitCode = failed === 0 ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
