import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { HEALTH_UNKNOWN_LABEL } from '../../src/components/entity-display/health';

const root = resolve(import.meta.dirname, '../../../../');

describe('Initiative health presentation', () => {
  it('uses health language and exposes only one health property in the masthead', () => {
    const properties = readFileSync(
      join(root, 'apps/web/src/components/initiatives/properties-panel.tsx'),
      'utf8',
    );
    const initiativeComponents = [
      'create-initiative.tsx',
      'distribution-bar.tsx',
      'initiative-catalog.ts',
      'initiative-form-pickers.tsx',
      'properties-panel.tsx',
      'roadmap.tsx',
    ]
      .map((file) => readFileSync(join(root, 'apps/web/src/components/initiatives', file), 'utf8'))
      .join('\n');

    // The Initiatives screens used to keep their own copy of the health tokens. Now that every
    // surface reads one module, the language ban has to cover that module too — it is where a
    // word like "verdict" would otherwise reappear and spread back out to all of them.
    const sharedHealth = readFileSync(
      join(root, 'apps/web/src/components/entity-display/health.tsx'),
      'utf8',
    );

    expect(HEALTH_UNKNOWN_LABEL).toBe('No health data');
    expect(properties).not.toContain('RolledUpHealthPill');
    expect(initiativeComponents.toLowerCase()).not.toContain('verdict');
    expect(sharedHealth.toLowerCase()).not.toContain('verdict');
  });
});
