import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../');

function source(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function priorities(path: string): number[] {
  return [...source(path).matchAll(/<EntityMetadataItem\b[^>]*\bpriority=\{(\d+)\}[^>]*>/g)].map(
    (match) => Number(match[1]),
  );
}

describe('strategic-work metadata priority', () => {
  it('declares Project properties in their progressive inline order', () => {
    expect(priorities('apps/web/src/components/project-detail/properties-panel.tsx')).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });

  it('declares Initiative properties in their progressive inline order', () => {
    expect(priorities('apps/web/src/components/initiatives/properties-panel.tsx')).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
  });

  it('declares Program and Cycle properties in their progressive inline order', () => {
    expect(priorities('apps/web/src/components/programs/properties-panel.tsx')).toEqual([
      0, 1, 2, 3,
    ]);
    expect(priorities('apps/web/src/components/cycle-detail/cycle-metadata-row.tsx')).toEqual([
      0, 1,
    ]);
  });

  it('gives every skeleton chip the same progressive item wrapper', () => {
    expect(source('apps/web/src/components/views/entity-detail-skeleton.tsx')).toMatch(
      /<EntityMetadataItem[\s\S]*priority=\{Math\.min\(index, 7\) as EntityMetadataPriority\}/,
    );
  });
});
