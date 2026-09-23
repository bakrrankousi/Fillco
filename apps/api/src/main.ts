import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './app.factory';
import { loadConfig } from './config';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await createApp();
  await app.listen(config.API_PORT);
  new Logger('Bootstrap').log(`Fillco API listening on http://localhost:${config.API_PORT}/api/v1`);
}

void main();
