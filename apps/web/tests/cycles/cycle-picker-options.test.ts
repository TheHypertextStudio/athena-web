/**
 * The cycle option builder behind the task detail's inline Cycle picker.
 *
 * @remarks
 * This is the second place a cycle is named to a reader (the roster being the first), and it was
 * the second place `Cycle <auto-roll number>` leaked from. The label is now the DTO's
 * `displayName`; the window still rides along as the muted hint, but only when the label is not
 * already the window — otherwise a picker row printed the same string twice.
 */
import { CycleOut } from '@docket/work/cycle-contract';
import { EntityDisplayOut } from '@docket/work/entity-display-contract';
import { describe, expect, it } from 'vitest';

import { cycleOptions } from '../../src/components/pickers/options';
import { formatWindow } from '../../src/components/cycles/format-window';

const IDS = {
  org: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  team: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  named: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  unnamed: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
};

const named = CycleOut.parse({
  id: IDS.named,
  organizationId: IDS.org,
  teamId: IDS.team,
  number: 1_000_135,
  name: 'Launch week',
  displayName: 'Launch week',
  startsAt: '2026-07-27T00:00:00.000Z',
  endsAt: '2026-08-02T23:59:59.999Z',
  status: 'active',
  createdAt: '2026-07-20T00:00:00.000Z',
});

const unnamed = CycleOut.parse({
  id: IDS.unnamed,
  organizationId: IDS.org,
  teamId: IDS.team,
  number: 1_000_136,
  name: null,
  displayName: 'Aug 3 – Aug 9',
  startsAt: '2026-08-03T00:00:00.000Z',
  endsAt: '2026-08-09T23:59:59.999Z',
  status: 'upcoming',
  createdAt: '2026-07-20T00:00:00.000Z',
});

describe('cycleOptions (task detail picker)', () => {
  it('labels every option by displayName and never by the auto-roll number', () => {
    const options = cycleOptions([named, unnamed], formatWindow);
    expect(options.map((o) => o.label)).toEqual(['Launch week', 'Aug 3 – Aug 9']);
    for (const option of options) {
      expect(option.label).not.toMatch(/Cycle \d{5,}/);
      expect(option.label).not.toContain('1000');
    }
  });

  it('hints a named cycle with its window', () => {
    const [option] = cycleOptions([named], formatWindow);
    expect(option?.hint).toBe('Jul 27 – Aug 2');
  });

  it('omits the hint when the label already is the window', () => {
    const [option] = cycleOptions([unnamed], formatWindow);
    expect(option?.hint).toBeUndefined();
  });

  it('carries a configured cycle glyph into the picker', () => {
    const display = EntityDisplayOut.parse({
      subjectType: 'cycle',
      subjectId: IDS.named,
      iconKey: 'rocket',
      colorKey: 'purple',
      customColor: '#6d28d9',
      coverImage: null,
      customized: true,
    });

    const [option] = cycleOptions([named], formatWindow, [display]);
    expect((option?.icon as { props?: unknown }).props).toMatchObject({
      iconKey: 'rocket',
      colorKey: 'purple',
      customColor: '#6d28d9',
      size: 20,
    });
  });
});
