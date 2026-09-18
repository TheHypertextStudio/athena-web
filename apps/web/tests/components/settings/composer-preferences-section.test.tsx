/**
 * Behavior tests for the Creating group on the Profile settings page.
 *
 * @remarks
 * The switch is the only write surface for `composer.resumeDrafts`. It must mirror the stored
 * value, send a focused PATCH carrying just the composer group (the API deep-merges it against
 * every sibling group), and never write anything else.
 */
import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { firstJson, jsonResponse } from '../../support/http';

const { getPreferences, patchPreferences } = vi.hoisted(() => ({
  getPreferences: vi.fn(),
  patchPreferences: vi.fn(),
}));

vi.mock('../../../src/lib/api', () => ({
  api: { v1: { hub: { preferences: { $get: getPreferences, $patch: patchPreferences } } } },
}));

import { ComposerPreferencesSection } from '../../../src/components/settings/composer-preferences-section';
import { useResumeDraftsPreference } from '../../../src/lib/drafts/defs';

/**
 * Mount the section against a stored preference body.
 *
 * @param preferences - What the first read returns.
 * @param afterPatch - What every read after a PATCH's invalidation returns; defaults to the same.
 */
function renderSection(
  preferences: Record<string, unknown>,
  afterPatch: Record<string, unknown> = preferences,
): void {
  getPreferences
    .mockResolvedValueOnce(jsonResponse(true, preferences))
    .mockResolvedValue(jsonResponse(true, afterPatch));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ComposerPreferencesSection />
    </QueryClientProvider>,
  );
}

/** Renders the shared reader's boolean so a test can observe what a composer would see. */
function ReaderProbe(): React.JSX.Element {
  const resume = useResumeDraftsPreference();
  return <output data-testid="reader">{String(resume)}</output>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ComposerPreferencesSection', () => {
  it('mirrors the stored preference and patches only the composer group when toggled on', async () => {
    patchPreferences.mockResolvedValue(
      jsonResponse(true, { theme: 'dark', composer: { resumeDrafts: true } }),
    );
    renderSection(
      { theme: 'dark', digest: { enabled: true } },
      { theme: 'dark', digest: { enabled: true }, composer: { resumeDrafts: true } },
    );

    const toggle = await screen.findByRole('switch');
    await waitFor(() => {
      expect(toggle).toBeEnabled();
    });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(patchPreferences).toHaveBeenCalledTimes(1);
    });
    expect(firstJson(patchPreferences.mock.calls)).toEqual({ composer: { resumeDrafts: true } });
    await waitFor(() => {
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    });
  });

  it('reflects an enabled preference and patches false when toggled off', async () => {
    patchPreferences.mockResolvedValue(jsonResponse(true, { composer: { resumeDrafts: false } }));
    renderSection({ composer: { resumeDrafts: true } });

    const toggle = await screen.findByRole('switch');
    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(patchPreferences).toHaveBeenCalledTimes(1);
    });
    expect(firstJson(patchPreferences.mock.calls)).toEqual({ composer: { resumeDrafts: false } });
  });

  it('announces a failed read instead of rendering a switch', async () => {
    getPreferences.mockResolvedValue(jsonResponse(false, { title: 'boom' }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ComposerPreferencesSection />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});

describe('useResumeDraftsPreference', () => {
  it('is false until the preference is stored as true', async () => {
    getPreferences.mockResolvedValue(jsonResponse(true, { composer: { resumeDrafts: true } }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReaderProbe />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('reader')).toHaveTextContent('false');
    await waitFor(() => {
      expect(screen.getByTestId('reader')).toHaveTextContent('true');
    });
  });
});
