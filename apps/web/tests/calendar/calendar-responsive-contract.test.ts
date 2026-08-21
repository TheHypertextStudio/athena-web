/** Source contracts for the calendar surfaces' narrow-layout geometry and scroll ownership. */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../');

function source(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function sourcesUnder(path: string): string[] {
  return readdirSync(join(root, path), { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return sourcesUnder(child);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [child] : [];
  });
}

const toolbarControlConsumers = [
  'apps/web/src/app/(app)/calendar/calendar-toolbar.tsx',
  'apps/web/src/app/(app)/calendar/calendar-view-settings.tsx',
  'apps/web/src/app/(app)/calendar/calendar-layers-menu.tsx',
  'apps/web/src/app/(app)/calendar/calendar-comparison-controls.tsx',
  'apps/web/src/components/calendar/create-block-form.tsx',
] as const;

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

  it('forbids refresh and sync state from taking space above the grid', () => {
    const surface = source('apps/web/src/app/(app)/calendar/calendar-scheduling-surface.tsx');

    expect(surface).not.toContain('data-calendar-status-row');
    expect(surface).not.toContain('CalendarSyncAlert');
    expect(surface).not.toContain('CalendarReadFailureNotice');
  });

  it('uses a seven-day desktop target instead of three oversized date lanes', () => {
    const surface = source('apps/web/src/app/(app)/calendar/calendar-scheduling-surface.tsx');

    expect(surface).toContain('minimumLaneWidth={160}');
    expect(surface).toContain('maximumVisibleLaneCount={7}');
  });

  it('keeps the 320px toolbar on one row with a visible primary action', () => {
    const toolbar = source('apps/web/src/app/(app)/calendar/calendar-toolbar.tsx');
    const create = source('apps/web/src/components/calendar/create-block-form.tsx');
    const control = source('apps/web/src/components/calendar/calendar-toolbar-control.ts');

    expect(toolbar).toContain('flex-nowrap');
    expect(toolbar).toContain("'h-10 w-10 min-w-10");
    expect(control).toContain("'min-h-10 w-10 min-w-10");
    expect(create).toContain('aria-label="New"');
    expect(toolbar).not.toContain("'h-9 w-9 min-w-9");
  });

  it('defines toolbar control geometry once in a neutral calendar module', () => {
    const sharedPath = 'apps/web/src/components/calendar/calendar-toolbar-control.ts';
    const shared = source(sharedPath);
    const recipe =
      'min-h-10 w-10 min-w-10 shrink gap-1.5 px-2 [&_svg]:size-4 @min-[22rem]:min-h-11';

    expect(shared).toContain('export const CALENDAR_CONTROL_CLASS');
    expect(shared).toContain(recipe);

    const calendarSources = [
      ...sourcesUnder('apps/web/src/app/(app)/calendar'),
      ...sourcesUnder('apps/web/src/components/calendar'),
    ];
    for (const path of calendarSources.filter((path) => path !== sharedPath)) {
      const consumer = source(path);
      expect(`${relative(root, join(root, path))}: ${consumer}`).not.toContain(recipe);
      expect(`${relative(root, join(root, path))}: ${consumer}`).not.toMatch(
        /(?:export\s+)?const\s+CALENDAR_CONTROL_CLASS\s*=/,
      );
    }
    for (const path of toolbarControlConsumers) {
      const consumer = source(path);
      expect(consumer).toContain('calendar-toolbar-control');
    }
  });
});
