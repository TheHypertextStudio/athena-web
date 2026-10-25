import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { it } from 'vitest';
import { fullSchema } from '../../src/client';
import { exerciseScheduleConversionPreparation } from '../fixtures/work-schedule-conversion';

it('prepares exact immutable calendar candidates while manual timezone stays explicitly retryable and no work activates', async () => {
  const client = new PGlite('memory://');
  const database = drizzle(client, { schema: fullSchema });
  const options = {
    migrationsFolder: resolve(import.meta.dirname, '../../drizzle'),
    applySqlMigrations: (folder: string) => migrate(database, { migrationsFolder: folder }),
  };
  try {
    await exerciseScheduleConversionPreparation(database, options);
  } finally {
    await client.close();
  }
});
