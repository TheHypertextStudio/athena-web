'use client';

import { ContextProvider } from '@docket/ui/components';
import { VocabularyProvider } from '@docket/ui/hooks';
import { TooltipProvider } from '@docket/ui/primitives';
import { ThemeProvider } from 'next-themes';
import type { JSX, ReactNode } from 'react';

/** Props for {@link Providers}. */
export interface ProvidersProps {
  /** The application subtree wrapped by every global client provider. */
  children: ReactNode;
}

/**
 * The composed client-side providers for the Docket product app.
 *
 * @remarks
 * Wraps the tree (outermost to innermost) in:
 *
 * 1. `next-themes` {@link ThemeProvider} — dark/light theming via the `class` attribute,
 *    matching the design-token stylesheet from `@docket/ui`.
 * 2. The `@docket/ui` `ContextProvider` — the active org/Hub context, density, and accent.
 * 3. The `@docket/ui` `VocabularyProvider` — entity-noun skinning (defaults to the Hub's
 *    startup preset until an org skin is bound deeper in the tree).
 * 4. The `@docket/ui` `TooltipProvider` — one shared open/skip-delay timing for every
 *    {@link Tooltip} in the app, so icon-only controls name themselves on hover/focus
 *    consistently (the inline responsiveness the Phase A review asked for).
 *
 * All four are Client Components, so this file carries the `'use client'` boundary and is
 * mounted once by the root layout.
 */
export function Providers({ children }: ProvidersProps): JSX.Element {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <ContextProvider>
        <VocabularyProvider>
          <TooltipProvider delayDuration={400}>{children}</TooltipProvider>
        </VocabularyProvider>
      </ContextProvider>
    </ThemeProvider>
  );
}
