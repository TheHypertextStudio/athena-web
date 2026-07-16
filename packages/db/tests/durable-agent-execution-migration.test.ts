import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(import.meta.dirname, '../drizzle/0042_durable_agent_execution.sql'),
  'utf8',
);

describe('durable agent execution migration', () => {
  it('adds the fenced action and generation contracts without data mutation', () => {
    expect(migration).toContain(`ADD VALUE 'executing'`);
    expect(migration).toContain(`ADD COLUMN "lease_token" text`);
    expect(migration).toContain(`agent_session_run_workflow_check`);
    expect(migration).toContain(`"workflow_instance_id" = "agent_session_run"."session_id"`);
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/i);
  });
});
