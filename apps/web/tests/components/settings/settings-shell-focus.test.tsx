import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsShell } from '@/components/settings/settings-shell';

vi.mock('@docket/ui/components', () => ({
  WorkspaceSwitcher: () => <button type="button">Workspace selector</button>,
}));

vi.mock('@/components/active-org', () => ({
  useActiveOrg: () => ({
    orgs: [{ id: 'personal', name: 'Personal', avatar: null }],
  }),
}));

vi.mock('@/lib/app-location', () => ({
  useAppPathname: () => '/settings/security',
}));

vi.mock('@/lib/interactions/navigation', () => ({
  useAppRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/components/settings/settings-shell-nav', () => ({
  SettingsShellNav: () => null,
  useSettingsShellWorkspace: () => ({ orgId: 'personal', isPersonal: true }),
}));

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SettingsShell route-fragment focus', () => {
  it('does not focus the workspace selector while a fragment destination is still mounting', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    window.history.replaceState(null, '', '/settings/security#settings-passkeys');

    render(<SettingsShell active>{null}</SettingsShell>);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Workspace selector' })).not.toHaveFocus();
    });
  });

  it('focuses a fragment that the router applies after the Settings dialog opens', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    window.history.replaceState(null, '', '/settings/security');
    render(
      <SettingsShell active>
        <h3 id="settings-passkeys" tabIndex={-1}>
          Passkeys
        </h3>
      </SettingsShell>,
    );

    window.history.replaceState(null, '', '/settings/security#settings-passkeys');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Passkeys' })).toHaveFocus();
    });
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      '/settings/security#settings-passkeys',
    );
  });

  it('consumes a cross-document focus hint before the URL hash arrives', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    window.history.replaceState(null, '', '/settings/security?route-focus=settings-passkeys');
    // The spy below must call the pre-spy method after simulating an inert heading.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const nativeFocus = HTMLElement.prototype.focus;
    let rejectedHeadingFocuses = 0;
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (
      this: HTMLElement,
      options?: FocusOptions,
    ) {
      if (this.id === 'settings-passkeys' && rejectedHeadingFocuses < 20) {
        rejectedHeadingFocuses += 1;
        return;
      }
      nativeFocus.call(this, options);
    });
    render(
      <SettingsShell active>
        <h3 id="settings-passkeys" tabIndex={-1}>
          Passkeys
        </h3>
      </SettingsShell>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Passkeys' })).toHaveFocus();
    });
    expect(rejectedHeadingFocuses).toBeGreaterThanOrEqual(20);
  });

  it("overrides the dialog's default initial control with the requested heading", async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    window.history.replaceState(null, '', '/settings/security#settings-passkeys');

    render(
      <SettingsShell active>
        <h3 id="settings-passkeys" tabIndex={-1}>
          Passkeys
        </h3>
      </SettingsShell>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Passkeys' })).toHaveFocus();
    });
  });

  it('restores the requested heading when a later dialog mount pass takes focus', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    window.history.replaceState(null, '', '/settings/security#settings-passkeys');
    render(
      <SettingsShell active>
        <h3 id="settings-passkeys" tabIndex={-1}>
          Passkeys
        </h3>
      </SettingsShell>,
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Passkeys' })).toHaveFocus();
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    screen.getByRole('button', { name: 'Workspace selector' }).focus();
    await new Promise((resolve) => setTimeout(resolve, 225));

    expect(screen.getByRole('heading', { name: 'Passkeys' })).toHaveFocus();
  });
});
