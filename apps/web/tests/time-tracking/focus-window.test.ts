/** Pop-out and same-tab behavior for immersive Focus. */
import { describe, expect, it, vi } from 'vitest';

import { launchFocusMode, returnFromFocus } from '@/components/time-tracking/focus-window';

describe('launchFocusMode', () => {
  it('opens a stable named pop-out and focuses it', () => {
    const focus = vi.fn();
    const open = vi.fn(() => ({ focus }));
    const navigate = vi.fn();

    expect(
      launchFocusMode({ open, navigate, mobile: false, returnPath: '/today?view=agenda' }),
    ).toBe('popout');
    expect(open).toHaveBeenCalledWith(
      '/focus?mode=popout&returnTo=%2Ftoday%3Fview%3Dagenda',
      'docket-focus',
      expect.stringContaining('noopener=no'),
    );
    expect(focus).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('falls back to same-tab navigation when the pop-up is blocked', () => {
    const navigate = vi.fn();
    expect(
      launchFocusMode({
        open: vi.fn(() => null),
        navigate,
        mobile: false,
        returnPath: '/orgs/org_1/tasks/task_1',
      }),
    ).toBe('same-tab');
    expect(navigate).toHaveBeenCalledWith('/focus?returnTo=%2Forgs%2Forg_1%2Ftasks%2Ftask_1');
  });

  it('uses same-tab mode on mobile without asking for a pop-up', () => {
    const open = vi.fn();
    const navigate = vi.fn();
    launchFocusMode({ open, navigate, mobile: true, returnPath: '/today' });
    expect(open).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/focus?returnTo=%2Ftoday');
  });
});

describe('returnFromFocus', () => {
  it('focuses the launching workspace and closes a Focus pop-out', () => {
    const opener = { closed: false, focus: vi.fn() };
    const close = vi.fn();
    const navigate = vi.fn();
    returnFromFocus({
      popout: true,
      opener,
      close,
      navigate,
      returnPath: '/today',
      origin: 'https://docket.hypertext.studio',
    });
    expect(opener.focus).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('returns in-tab Focus only to a validated same-origin launch path', () => {
    const navigate = vi.fn();
    returnFromFocus({
      popout: false,
      opener: null,
      close: vi.fn(),
      navigate,
      returnPath: '/orgs/org_1/tasks/task_1?tab=activity',
      origin: 'https://docket.hypertext.studio',
    });
    expect(navigate).toHaveBeenCalledWith('/orgs/org_1/tasks/task_1?tab=activity');

    navigate.mockClear();
    returnFromFocus({
      popout: false,
      opener: null,
      close: vi.fn(),
      navigate,
      returnPath: 'https://elsewhere.example/previous',
      origin: 'https://docket.hypertext.studio',
    });
    expect(navigate).toHaveBeenCalledWith('/today');
  });
});
