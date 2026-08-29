import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');

describe('external agent durable-core boundary', () => {
  it.each([
    'external-agent-inbox.ts',
    'external-agent-processor.ts',
    'external-agent-publisher.ts',
    'external-agent-relay.ts',
  ])('%s dispatches through adapters instead of branching on provider names', (filename) => {
    const source = readFileSync(resolve(ROOT, 'apps/api/src/lib', filename), 'utf8');

    expect(source).not.toMatch(/switch\s*\([^)]*provider/i);
    expect(source).not.toMatch(/provider\s*[!=]==?\s*['"](?:linear|slack|github|jira_a2a)['"]/);
    expect(source).not.toMatch(/case\s+['"](?:linear|slack|github|jira_a2a)['"]/);
    expect(source).not.toMatch(/const\s+(?:inbox|integration)Provider\s*=\s*\{/);
  });

  it('validates the routed installation against the adapter installation key', () => {
    const source = readFileSync(
      resolve(ROOT, 'apps/api/src/lib/external-agent-processor.ts'),
      'utf8',
    );

    expect(source).toContain('installed.provider !== normalized?.routing.installProvider');
    expect(source).not.toContain('installed.provider !== normalized.routing.inboxProvider');
  });

  it('keeps the shared HTTP ingress provider-blind', () => {
    const source = readFileSync(
      resolve(ROOT, 'apps/api/src/routes/ingest-agent-surface.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/switch\s*\([^)]*provider/i);
    expect(source).not.toMatch(/provider\s*[!=]==?\s*['"](?:linear|slack|github|jira_a2a)['"]/);
    expect(source).not.toMatch(/case\s+['"](?:linear|slack|github|jira_a2a)['"]/);
  });
});
