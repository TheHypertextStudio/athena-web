import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(import.meta.dirname, '../drizzle/0045_durable_athena_dispatch.sql'),
  'utf8',
);

describe('durable Athena dispatch migration', () => {
  it('adds only the payload-free leased outbox DDL', () => {
    expect(migration).toContain('CREATE TABLE "agent_session_dispatch"');
    expect(migration).toContain('agent_session_dispatch_run_action_uq');
    expect(migration).toContain('agent_session_dispatch_due_idx');
    expect(migration).toContain('agent_session_dispatch_lease_idx');
    expect(migration).toContain("in ('enqueue', 'wake')");
    expect(migration).toContain("in ('pending', 'delivering', 'delivered', 'failed')");
    expect(migration).not.toMatch(/\b(?:prompt|credential|owner_user|tool_input|payload)\b/i);
    expect(migration).not.toMatch(/^\s*(?:INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM)\b/im);
  });
});
