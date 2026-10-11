import { act } from '@testing-library/react';
import type * as WallTime from '@docket/planning/wall-time';
import type { ReactNode } from 'react';
import type * as FormatDate from '../../src/lib/format-date';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CreatedOriginChip,
  CreatedOriginDate,
} from '../../src/components/provenance/created-origin';

const fixture = vi.hoisted(() => ({ timezone: 'UTC' }));
vi.mock('../../src/lib/format-date', async (importOriginal) => {
  const actual = await importOriginal<typeof FormatDate>();
  return {
    ...actual,
    formatCalendarDate: (value: string, options?: Intl.DateTimeFormatOptions) =>
      actual.formatCalendarDate(value, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        ...options,
        timeZone: options?.timeZone ?? fixture.timezone,
      }),
  };
});
vi.mock('@docket/planning/wall-time', async (importOriginal) => ({
  ...(await importOriginal<typeof WallTime>()),
  resolveScheduleTimezone: (timezone: string | undefined) => timezone ?? fixture.timezone,
}));
vi.mock('../../src/components/views/entity-detail-context', () => ({
  useEntityDetailObject: () => null,
}));
vi.mock('../../src/components/views/entity-detail-layout', () => ({
  ENTITY_METADATA_CHIP_CLASS: '',
  EntityMetadataItem: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../../src/components/provenance/origin-card', () => ({
  OriginHoverCard: ({ children }: { children: ReactNode }) => children,
}));

let root: Root | undefined;
afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('Created timestamp hydration', () => {
  it.each([CreatedOriginDate, CreatedOriginChip])(
    'keeps the initial timestamp stable before showing the viewer date: %s',
    async (Created) => {
      fixture.timezone = 'UTC';
      const container = document.createElement('div');
      container.innerHTML = renderToString(<Created createdAt="2026-10-11T05:00:00Z" />);
      document.body.append(container);
      expect(container.textContent).toContain('Oct 11, 2026');
      fixture.timezone = 'America/Los_Angeles';
      const errors: unknown[] = [];
      await act(async () => {
        root = hydrateRoot(container, <Created createdAt="2026-10-11T05:00:00Z" />, {
          onRecoverableError: (error) => errors.push(error),
        });
      });
      expect(errors).toEqual([]);
      expect(container.textContent).toContain('Oct 10, 2026');
    },
  );
});
