import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().default(4000),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(12),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Comma separated origins allowed to call the API directly (the web app normally proxies instead). */
  CORS_ORIGINS: z.string().default(''),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().default(15),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (!cached) {
    const parsed = schema.safeParse(env);
    if (!parsed.success) {
      throw new Error(
        `Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
      );
    }
    cached = parsed.data;
  }
  return cached;
}

export const SESSION_COOKIE = 'fillco_session';
export const CSRF_HEADER = 'x-csrf-token';
