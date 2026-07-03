'use client';

import { ContextProvider } from '@docket/ui/components';
import { VocabularyProvider } from '@docket/ui/hooks';
import { TooltipProvider } from '@docket/ui/primitives';
import { QueryClientProvider } from '@tanstack/react-query';
import { type JSX, type ReactNode, useEffect, useState } from 'react';

import { createQueryClient } from '@/lib/query';

/** Props for {@link Providers}. */
export interface ProvidersProps {
  /** The application subtree wrapped by every global client provider. */
  children: ReactNode;
}

type ThemePreference = 'light' | 'dark' | 'system';

/** The localStorage key historically used by `next-themes`, kept for compatibility. */
const THEME_STORAGE_KEY = 'theme';

/** The media query that resolves a `system` preference into the active class. */
const DARK_MODE_QUERY = '(prefers-color-scheme: dark)';

/** Read the persisted theme preference, falling back to `system` when unset or invalid. */
function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  } catch {
    return 'system';
  }
}

/** Apply the resolved theme class and color-scheme to the document element. */
function applyThemeClass(preference: ThemePreference, systemDark: boolean): void {
  const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
}

/**
 * Keep the root `dark` class in sync without rendering an inline script from a Client Component.
 */
function useThemeClass(): void {
  useEffect(() => {
    const media = window.matchMedia(DARK_MODE_QUERY);
    const sync = (): void => {
      applyThemeClass(readThemePreference(), media.matches);
    };
    sync();
    media.addEventListener('change', sync);
    window.addEventListener('storage', sync);
    return () => {
      media.removeEventListener('change', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
}

/**
 * The composed client-side providers for the Docket product app.
 *
 * @remarks
 * Wraps the tree (outermost to innermost) in:
 *
 * 1. A local root-class theme sync — dark/light theming via the `class` attribute, matching the
 *    design-token stylesheet from `@docket/ui`, without rendering a client-side `<script>`.
 * 2. The `@docket/ui` `ContextProvider` — the active org/Hub context, density, and accent.
 * 3. The `@docket/ui` `VocabularyProvider` — entity-noun skinning (defaults to the Hub's
 *    startup preset until an org skin is bound deeper in the tree).
 * 4. The `@docket/ui` `TooltipProvider` — one shared open/skip-delay timing for every
 *    {@link Tooltip} in the app, so icon-only controls name themselves on hover/focus
 *    consistently (the inline responsiveness the Phase A review asked for).
 * 5. TanStack Query's `QueryClientProvider` — the dynamic-data layer that backs every
 *    read/mutation hook in `@/lib/query`, so data surfaces auto-refetch on window focus
 *    and after mutations instead of needing a manual "Refresh" button.
 *
 * All are Client Components, so this file carries the `'use client'` boundary and is
 * mounted once by the root layout. The {@link QueryClient} is created via `useState` (lazy
 * initializer) so a single, stable client survives re-renders without leaking across requests
 * — the App Router client-component pattern for TanStack Query.
 */
export function Providers({ children }: ProvidersProps): JSX.Element {
  const [queryClient] = useState(createQueryClient);
  useThemeClass();
  return (
    <ContextProvider>
      <VocabularyProvider>
        <TooltipProvider delayDuration={400}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </TooltipProvider>
      </VocabularyProvider>
    </ContextProvider>
  );
}
