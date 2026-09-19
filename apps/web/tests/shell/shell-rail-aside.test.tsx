/** Behavior tests for which panels the shell's right rail offers on a route. */
import { describe, expect, it } from 'vitest';

import type { RailPanel } from '@docket/ui/components';

import { athenaRailUnavailable, railAsideFor } from '../../src/components/shell-rail-aside';
import type { TimerStatus } from '../../src/components/time-tracking';

const IDLE: TimerStatus = {
  phase: 'idle',
  title: '',
  unanchored: false,
  suggestion: null,
  nudging: false,
  loading: false,
  error: null,
};

function athena(tone?: 'attention' | 'active'): RailPanel {
  return {
    id: 'athena',
    label: 'Athena',
    icon: null,
    node: null,
    ...(tone ? { status: { tone, label: 'Athena status' } } : {}),
  };
}

describe('railAsideFor', () => {
  it('leads with Athena, and opens on it only while something waits on the person', () => {
    const quiet = railAsideFor(false, IDLE, athena(), '/today');
    const waiting = railAsideFor(false, IDLE, athena('attention'), '/today');

    expect(quiet.panels.map((panel) => panel.id)).toEqual(['athena', 'agenda', 'focus']);
    expect(quiet.defaultPanelId).toBe('agenda');
    expect(waiting.defaultPanelId).toBe('athena');
  });

  it('leaves Athena out on /athena, which is the conversation at full width', () => {
    const aside = railAsideFor(false, IDLE, athena('attention'), '/athena');

    expect(aside.panels.map((panel) => panel.id)).toEqual(['agenda', 'focus']);
    expect(aside.defaultPanelId).toBe('agenda');
  });
});

describe('athenaRailUnavailable', () => {
  it('is true on settings, the calendar, and /athena, and false elsewhere', () => {
    expect(athenaRailUnavailable('/athena', false, false)).toBe(true);
    expect(athenaRailUnavailable('/settings', true, false)).toBe(true);
    expect(athenaRailUnavailable('/calendar', false, true)).toBe(true);
    expect(athenaRailUnavailable('/today', false, false)).toBe(false);
  });
});
