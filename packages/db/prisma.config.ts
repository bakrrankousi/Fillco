import { defineConfig } from 'prisma/config';
import { loadRootEnv } from './src/env';

// With a config file Prisma no longer reads .env itself; share the repository's root .env instead.
loadRootEnv(__dirname);

export default defineConfig({ schema: 'prisma/schema.prisma' });
