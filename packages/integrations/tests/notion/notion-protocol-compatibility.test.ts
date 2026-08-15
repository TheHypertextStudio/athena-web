/** Legacy linked-Notion callers retain the Connections-owned protocol constant. */
import { describe, expect, it } from 'vitest';

import { NOTION_API_VERSION as connectionProtocolVersion } from '@docket/connections/notion/protocol';

import { NOTION_API_VERSION as legacyNotionMappingVersion } from '../../src/notion-mapping';

describe('Notion protocol compatibility', () => {
  it('re-exports the Connections-owned Notion API version for legacy mapping callers', () => {
    expect(legacyNotionMappingVersion).toBe(connectionProtocolVersion);
  });
});
