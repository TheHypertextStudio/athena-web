import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(import.meta.dirname, '../drizzle/0043_personal_athena.sql'),
  'utf8',
);

describe('personal Athena migration', () => {
  it('creates only fresh personal schema and never infers legacy ownership', () => {
    expect(migration).toContain('personal_mcp_connection');
    expect(migration).toContain('athena_assignment');
    expect(migration).toContain('athena_trigger');
    expect(migration).not.toMatch(/^\s*(?:INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM)\b/im);
  });
});
