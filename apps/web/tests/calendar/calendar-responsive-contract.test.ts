/** Source contracts for the calendar surfaces' narrow-layout geometry and scroll ownership. */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../');

function source(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

describe('Calendar responsive layout contract', () => {
  it('gives vertical scrolling only to the shared scheduling canvas', () => {
    const client = source('apps/web/src/app/(app)/calendar/calendar-client.tsx');
    const schedulingCanvas = source('apps/web/src/components/scheduling/scheduling-canvas.tsx');

    expect(client).toMatch(
      /data-calendar-page=""\s+className="flex h-full min-h-0 w-full min-w-0 flex-col/,
    );
    expect(client).toMatch(/data-calendar-page=""[^>]*\boverflow-hidden\b/);
    expect(client).not.toMatch(/data-calendar-page=""[^>]*\boverflow-y-auto\b/);
    expect(schedulingCanvas).toMatch(
      /aria-label="Schedule"[\s\S]*?className={`[^`]*\boverflow-auto\b/,
    );
  });

  it('lets the grid shrink to the available height instead of overflowing a hidden page', () => {
    const surface = source('apps/web/src/app/(app)/calendar/calendar-scheduling-surface.tsx');

    expect(surface).toContain('data-calendar-canvas-host=""');
    expect(surface).toMatch(/data-calendar-canvas-host=""[^>]*\bmin-h-0\b[^>]*\bflex-1\b/);
    expect(surface).not.toContain('min-h-[max(16rem,45dvh)]');
  });

  it('keeps secondary calendar state in one compact row above the grid', () => {
    const surface = source('apps/web/src/app/(app)/calendar/calendar-scheduling-surface.tsx');

    expect(surface).toMatch(
      /data-calendar-status-row=""[^>]*\bflex-nowrap\b[^>]*\boverflow-hidden\b/,
    );
  });

  it('keeps the 320px toolbar on one row with a visible primary action', () => {
    const toolbar = source('apps/web/src/app/(app)/calendar/calendar-toolbar.tsx');
    const create = source('apps/web/src/components/calendar/create-block-form.tsx');

    expect(toolbar).toContain('flex-nowrap');
    expect(toolbar).toContain("'h-10 w-10 min-w-10");
    expect(create).toContain("'min-h-10 w-10 min-w-10");
    expect(create).toContain('aria-label="New"');
    expect(toolbar).not.toContain("'h-9 w-9 min-w-9");
  });
});
