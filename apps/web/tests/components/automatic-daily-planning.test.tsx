import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const dayData: { accepted: unknown; draft: unknown } = { accepted: null, draft: null };
  return {
    pathname: '/today',
    search: '',
    preferences: {
      data: {
        timezone: 'America/Los_Angeles',
        windows: [
          { weekday: 5, startMinute: 540, endMinute: 720, kind: 'desk' },
          { weekday: 5, startMinute: 780, endMinute: 1020, kind: 'desk' },
          { weekday: 5, startMinute: 420, endMinute: 480, kind: 'personal' },
        ],
      },
      isSuccess: true,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    },
    day: {
      data: dayData,
      isSuccess: true,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    },
    push: vi.fn(),
    requestedHref: null as string | null,
  };
});
vi.mock('../../src/lib/app-location', () => ({
  useAppPathname: () => state.pathname,
  useAppSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock('../../src/lib/interactions/navigation', () => ({
  useAppRouter: () => ({ push: state.push, requestedHref: state.requestedHref }),
}));
vi.mock('../../src/components/scheduling-plan/use-schedule-plan', () => ({
  useSchedulingPreferences: () => state.preferences,
}));
vi.mock('../../src/components/daily-planning/daily-planning-queries', () => ({
  useDailyPlanningDay: () => state.day,
}));
import { AutomaticDailyPlanning } from '../../src/components/daily-planning/automatic-daily-planning';

let visible = true;
let focused = true;
let userId = '';
function mount() {
  return render(<AutomaticDailyPlanning userId={userId} />);
}
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}
async function foreground(value: boolean, event = 'visibilitychange') {
  visible = value;
  focused = value;
  await act(async () => {
    (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event));
  });
}
beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'Date',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'performance',
    ],
  });
  vi.setSystemTime(new Date('2026-10-02T17:00:00Z'));
  userId = String(Math.random());
  state.pathname = '/today';
  state.search = '';
  state.requestedHref = null;
  state.day.data = { accepted: null, draft: null };
  state.day.isSuccess = true;
  state.day.isError = false;
  state.day.isFetching = false;
  state.preferences.isSuccess = true;
  state.preferences.isError = false;
  state.preferences.data.timezone = 'America/Los_Angeles';
  state.push.mockReset();
  state.push.mockReturnValue(true);
  state.day.refetch
    .mockReset()
    .mockImplementation(async () => ({ data: state.day.data, isSuccess: true }));
  state.preferences.refetch
    .mockReset()
    .mockImplementation(async () => ({ data: state.preferences.data, isSuccess: true }));
  visible = true;
  focused = true;
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() =>
    visible ? 'visible' : 'hidden',
  );
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('automatic daily planning', () => {
  it('announces once and shows a five second countdown before opening the existing route', async () => {
    mount();
    expect(screen.getByRole('dialog', { name: 'It’s time to plan your day' })).toBeVisible();
    expect(screen.getByText('Opening planner in 5 seconds.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /close|later|skip|dismiss/i })).toBeNull();
    await advance(1000);
    expect(screen.getByText('Opening planner in 4 seconds.')).toBeVisible();
    expect(screen.getByText('Opening planner in 4 seconds.').closest('[aria-live]')).toBeNull();
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      'Opening planner in five seconds.',
    );
    await advance(4000);
    expect(state.push).toHaveBeenCalledExactlyOnceWith('/plan?view=day&date=2026-10-02');
  });
  it('gives a full five seconds when eligibility arrives between foreground heartbeats', async () => {
    state.preferences.isSuccess = false;
    const view = mount();
    await advance(1500);
    state.preferences.isSuccess = true;
    view.rerender(<AutomaticDailyPlanning userId={userId} />);
    expect(screen.getByText('Opening planner in 5 seconds.')).toBeVisible();
    await advance(4999);
    expect(state.push).not.toHaveBeenCalled();
    await advance(1);
    expect(state.push).toHaveBeenCalledTimes(1);
  });
  it('Plan now enters immediately and outside clicks cannot dismiss it', async () => {
    mount();
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    expect(screen.getByRole('dialog')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Plan now' }));
    expect(state.push).toHaveBeenCalledExactlyOnceWith('/plan?view=day&date=2026-10-02');
    await advance(6000);
    expect(state.push).toHaveBeenCalledTimes(1);
  });
  it('Escape proceeds immediately', () => {
    mount();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
    expect(state.push).toHaveBeenCalledExactlyOnceWith('/plan?view=day&date=2026-10-02');
  });
  it.each(['visibilitychange', 'blur'])(
    'cancels on %s and restarts all five seconds after a fresh read',
    async (event) => {
      mount();
      await advance(3000);
      await foreground(false, event);
      await advance(10000);
      expect(state.push).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).toBeNull();
      await foreground(true, event === 'blur' ? 'focus' : event);
      expect(state.day.refetch).toHaveBeenCalled();
      expect(screen.getByText('Opening planner in 5 seconds.')).toBeVisible();
      await advance(5000);
      expect(state.push).toHaveBeenCalledTimes(1);
    },
  );
  it('suppresses an accepted day even when an adjustment draft exists', () => {
    state.day.data = { accepted: { id: 'accepted' }, draft: { id: 'draft' } };
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('resumes a saved draft through the ordinary planner route', () => {
    state.day.data.draft = { resumeStep: 'review_plan' };
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Plan now' }));
    expect(state.push).toHaveBeenCalledWith('/plan?view=day&date=2026-10-02');
  });
  it('cancels if the accepted query changes during countdown', async () => {
    const view = mount();
    await advance(2000);
    state.day.data.accepted = { id: 'confirmed' };
    view.rerender(<AutomaticDailyPlanning userId={userId} />);
    await advance(4000);
    expect(state.push).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('does not use the stale day after returning from the background', async () => {
    mount();
    await foreground(false);
    state.day.refetch.mockImplementation(async () => {
      state.day.data = { accepted: {}, draft: null };
      return { data: state.day.data, isSuccess: true };
    });
    await foreground(true);
    await advance(20000);
    expect(state.push).not.toHaveBeenCalled();
  });
  it.each(['2026-10-02T15:59:59Z', '2026-10-03T00:00:00Z', '2026-10-03T17:00:00Z'])(
    'stays quiet outside the local workday at %s',
    (instant) => {
      vi.setSystemTime(new Date(instant));
      mount();
      expect(screen.queryByRole('dialog')).toBeNull();
    },
  );
  it('enters at the start of a workday without reloading another route', async () => {
    state.pathname = '/library';
    vi.setSystemTime(new Date('2026-10-02T15:59:58Z'));
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
    await advance(2000);
    expect(screen.getByText('Opening planner in 5 seconds.')).toBeVisible();
  });
  it('uses the Hub date rather than the browser or UTC date', () => {
    state.preferences.data.timezone = 'Pacific/Honolulu';
    vi.setSystemTime(new Date('2026-10-03T00:00:00Z'));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Plan now' }));
    expect(state.push).toHaveBeenCalledWith('/plan?view=day&date=2026-10-02');
  });
  it.each(['day', 'preferences'] as const)('stays quiet on a %s read failure', (query) => {
    state[query].isSuccess = false;
    state[query].isError = true;
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('resumes eligibility when a failed return read later recovers in the foreground', async () => {
    const view = mount();
    await foreground(false);
    state.day.refetch.mockImplementation(async () => {
      state.day.isSuccess = false;
      state.day.isError = true;
      return { isSuccess: false };
    });
    await foreground(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    state.day.isSuccess = true;
    state.day.isError = false;
    view.rerender(<AutomaticDailyPlanning userId={userId} />);
    expect(screen.getByText('Opening planner in 5 seconds.')).toBeVisible();
  });
  it('does not reopen while already on the daily planner', () => {
    state.pathname = '/plan';
    state.search = 'view=day&date=2026-10-02';
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('records entry only after the destination commits and suppresses a remount', () => {
    const view = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Plan now' }));
    expect(window.localStorage.length).toBe(0);
    state.pathname = '/plan';
    state.search = 'view=day&date=2026-10-02';
    view.rerender(<AutomaticDailyPlanning userId={userId} />);
    expect(window.localStorage.length).toBe(1);
    view.unmount();
    state.pathname = '/today';
    state.search = '';
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('falls back to memory if storage fails', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const view = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Plan now' }));
    state.pathname = '/plan';
    state.search = 'view=day&date=2026-10-02';
    view.rerender(<AutomaticDailyPlanning userId={userId} />);
    view.unmount();
    state.pathname = '/today';
    state.search = '';
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('cancels when another modal takes ownership during countdown', async () => {
    mount();
    await advance(2000);
    const other = document.createElement('div');
    other.setAttribute('role', 'dialog');
    other.setAttribute('data-state', 'open');
    document.body.append(other);
    await advance(1000);
    expect(screen.queryByRole('dialog', { name: 'It’s time to plan your day' })).toBeNull();
    await advance(5000);
    expect(state.push).not.toHaveBeenCalled();
    other.remove();
  });
  it('suppresses another tab’s committed entry during countdown', async () => {
    mount();
    await advance(1000);
    const key = `docket.daily-planning.entry:${JSON.stringify([userId, 'America/Los_Angeles', '2026-10-02'])}`;
    window.localStorage.setItem(key, '1');
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: '1' }));
    });
    await advance(10000);
    expect(state.push).not.toHaveBeenCalled();
  });
  it('can retry an uncommitted navigation after returning to the foreground', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Plan now' }));
    expect(window.localStorage.length).toBe(0);
    await advance(20000);
    expect(state.push).toHaveBeenCalledTimes(1);
    await foreground(false);
    await foreground(true);
    expect(screen.getByText('Opening planner in 5 seconds.')).toBeVisible();
    await advance(5000);
    expect(state.push).toHaveBeenCalledTimes(2);
  });
  it('does not let yesterday’s accepted plan block a new day after returning', async () => {
    state.day.data.accepted = { id: 'yesterday' };
    const view = mount();
    await foreground(false);
    vi.setSystemTime(new Date('2026-10-09T17:00:00Z'));
    state.day.refetch.mockImplementation(async () => {
      return { data: { accepted: { id: 'yesterday' } }, isSuccess: true };
    });
    await foreground(true);
    state.day.data = { accepted: null, draft: null };
    view.rerender(<AutomaticDailyPlanning userId={userId} />);
    expect(screen.getByText('Opening planner in 5 seconds.')).toBeVisible();
  });
  it('reevaluates a new local day while the shell stays mounted', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Plan now' }));
    vi.setSystemTime(new Date('2026-10-09T17:00:00Z'));
    await advance(1000);
    expect(screen.getByText('Opening planner in 5 seconds.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Plan now' }));
    expect(state.push).toHaveBeenLastCalledWith('/plan?view=day&date=2026-10-09');
  });
  it('stays quiet while the person edits another surface', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
    input.remove();
  });
});
