/** The old generic-types entry stays a thin import bridge while Connections takes ownership. */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const legacyFacade = readFileSync(new URL('../../src/notion-mirror.ts', import.meta.url), 'utf8');

describe('Notion mirror compatibility facade', () => {
  it('re-exports the Connections contract without keeping a duplicate schema', () => {
    expect(legacyFacade).toBe(`/**
 * Legacy compatibility export for the Connections-owned Notion mirror contract.
 *
 * @deprecated Import from \`@docket/connections/notion/mirror-contract\`.
 */
export * from '@docket/connections/notion/mirror-contract';
`);
  });
});
