/** Source contracts for Agenda's presentation-specific single-scroll-owner layout. */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../');

function source(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

describe('Agenda scroll ownership', () => {
  it('leaves timeline scrolling to the shared scheduling canvas', () => {
    const agenda = source('apps/web/src/components/agenda/agenda.tsx');
    const canvas = source('apps/web/src/components/agenda/agenda-canvas.tsx');

    expect(agenda).toContain('className="min-h-0 flex-1 overflow-hidden"');
    expect(canvas).toContain('<SchedulingCanvas');
    expect(canvas).toContain('viewportHeight="100%"');
  });

  it('gives list presentation one local vertical scroll owner', () => {
    const list = source('apps/web/src/components/agenda/agenda-list-arrangement.tsx');

    expect(list).toContain('data-agenda-list-scroll=""');
    expect(list).toMatch(/data-agenda-list-scroll=""[^>]*\bh-full\b[^>]*\boverflow-y-auto\b/);
  });
});
