import '@testing-library/jest-dom/vitest';

/**
 * The settings modal's responsive pane — one list beside the content on a desktop, one *or* the
 * other on a phone.
 *
 * @remarks
 * The rail is a fixed `w-52`, and beside the shell's `gap-8` and `p-5` that cost 280px, leaving the
 * content pane roughly 110px at 390px (`docs/design/audits/2026-08-14-publishing-addresses.md`,
 * finding 1). Below `sm` the pane now shows one view at a time: the section list, or a section with
 * a control back to the list.
 *
 * What is pinned here is that state machine, because it is the part a screenshot cannot hold: you
 * can always get from a section back to the list, and choosing from the list always lands you on a
 * section. Which of the two is *visible* at a given width is a CSS breakpoint question jsdom cannot
 * answer; the captured 390×844 evidence carries that half.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsPane } from '../../../src/components/settings/settings-pane';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** jsdom implements no scrolling, so the pane's scroll-into-view needs a stub to be observable. */
function stubScrollIntoView(): ReturnType<typeof vi.fn> {
  const scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: scrollIntoView,
  });
  return scrollIntoView;
}

/** The control that leaves a section for the list; absent while the list is already showing. */
function backControl(): HTMLElement | null {
  return screen.queryByRole('button', { name: /all settings/i });
}

/** Use that control, failing loudly if the section view is not the one currently showing. */
function goBackToList(): void {
  fireEvent.click(screen.getByRole('button', { name: /all settings/i }));
}

function renderPane(): void {
  render(
    <SettingsPane
      renderNav={(onNavigate) => (
        <nav aria-label="Settings sections">
          <button type="button" onClick={onNavigate}>
            Profile
          </button>
        </nav>
      )}
    >
      <p>Section content</p>
    </SettingsPane>,
  );
}

describe('SettingsPane', () => {
  it('reports whether the visible settings content has scrolled', () => {
    const onScrolledChange = vi.fn();
    render(
      <SettingsPane
        onScrolledChange={onScrolledChange}
        renderNav={() => <nav aria-label="Settings sections" />}
      >
        <p>Section content</p>
      </SettingsPane>,
    );
    const content = screen.getByRole('region', { name: 'Settings content' });

    Object.defineProperty(content, 'scrollTop', { configurable: true, writable: true, value: 24 });
    fireEvent.scroll(content);
    expect(onScrolledChange).toHaveBeenLastCalledWith(true);

    content.scrollTop = 0;
    fireEvent.scroll(content);
    expect(onScrolledChange).toHaveBeenLastCalledWith(false);
  });

  it('opens on the section the URL names, with a way back to the list', () => {
    renderPane();

    expect(screen.getByText('Section content')).toBeInTheDocument();
    expect(backControl()).toBeInTheDocument();
  });

  it('leaves the section for the list when the back control is used', () => {
    renderPane();

    goBackToList();

    expect(backControl()).not.toBeInTheDocument();
  });

  it('returns to the section view once the list is used to choose one', () => {
    renderPane();
    goBackToList();

    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));

    expect(backControl()).toBeInTheDocument();
  });

  it('opens the list on the section the viewer came from, not at the top', () => {
    const scrollIntoView = stubScrollIntoView();
    render(
      <SettingsPane
        renderNav={() => (
          <nav aria-label="Settings sections">
            <a href="/settings/profile">Profile</a>
            <a href="/settings/security" aria-current="page">
              Security
            </a>
          </nav>
        )}
      >
        <p>Section content</p>
      </SettingsPane>,
    );

    goBackToList();

    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect((scrollIntoView.mock.instances[0] as HTMLElement).getAttribute('href')).toBe(
      '/settings/security',
    );
  });

  it('keeps the nav mounted throughout — it is the desktop rail at every step', () => {
    renderPane();
    expect(screen.getByRole('navigation')).toBeInTheDocument();

    goBackToList();
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('scrolls to and focuses the Settings heading named by the route fragment', async () => {
    const scrollIntoView = stubScrollIntoView();
    window.history.replaceState(null, '', '/settings/security#settings-passkeys');
    render(
      <SettingsPane renderNav={() => null}>
        <h3 id="settings-passkeys" tabIndex={-1}>
          Passkeys
        </h3>
      </SettingsPane>,
    );

    const heading = await screen.findByRole('heading', { name: 'Passkeys' });
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
      expect(heading).toHaveFocus();
    });
  });

  it("applies route-fragment focus after the dialog's initial focus move", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    window.history.replaceState(null, '', '/settings/security#settings-passkeys');
    render(
      <SettingsPane renderNav={() => null}>
        <button type="button">Workspace selector</button>
        <h3 id="settings-passkeys" tabIndex={-1}>
          Passkeys
        </h3>
      </SettingsPane>,
    );

    screen.getByRole('button', { name: 'Workspace selector' }).focus();
    act(() => {
      frames.forEach((frame) => {
        frame(0);
      });
    });

    expect(screen.getByRole('heading', { name: 'Passkeys' })).toHaveFocus();
  });

  it('focuses a Settings heading when the router applies its fragment after mounting', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    window.history.replaceState(null, '', '/settings/security');
    render(
      <SettingsPane renderNav={() => null}>
        <h3 id="settings-passkeys" tabIndex={-1}>
          Passkeys
        </h3>
      </SettingsPane>,
    );

    window.history.replaceState(null, '', '/settings/security#settings-passkeys');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    act(() => {
      frames.forEach((frame) => {
        frame(0);
      });
    });

    expect(screen.getByRole('heading', { name: 'Passkeys' })).toHaveFocus();
  });

  it('waits for a route fragment that appears after the first mounted frame', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    window.history.replaceState(null, '', '/settings/security');
    render(
      <SettingsPane renderNav={() => null}>
        <h3 id="settings-passkeys" tabIndex={-1}>
          Passkeys
        </h3>
      </SettingsPane>,
    );

    act(() => {
      frames.shift()?.(0);
    });
    window.history.replaceState(null, '', '/settings/security#settings-passkeys');
    act(() => {
      while (frames.length > 0) frames.shift()?.(16);
    });

    expect(screen.getByRole('heading', { name: 'Passkeys' })).toHaveFocus();
  });
});
