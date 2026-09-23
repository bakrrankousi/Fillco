import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Loads the repo .env (if present) and points DATABASE_URL at the test database. */
export function loadTestEnv(): string {
  const file = resolve(__dirname, '../../../.env');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
    }
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  if (!/@(localhost|127\.0\.0\.1|postgres)(:\d+)?\//.test(url))
    throw new Error(`Refusing to run tests against ${url}`);
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';
  process.env.LOGIN_MAX_ATTEMPTS ??= '5';
  return url;
}
