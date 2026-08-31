'use client';

import { TooltipProvider } from '@docket/ui/primitives';
import { QueryClientProvider } from '@tanstack/react-query';
import { type JSX, type ReactNode, useState } from 'react';

import { ImpersonationProvider } from '@/components/impersonation';
import { createQueryClient } from '@/lib/query';

/** Props for {@link Providers}. */
export interface ProvidersProps {
  /** The application subtree wrapped by every global client provider. */
  children: ReactNode;
}

/**
 * The composed client-side providers for the Docket service-admin console.
 *
 * @remarks
 * Wraps the tree (outermost to innermost) in:
 *
 * 1. The {@link QueryClientProvider} — the console's dynamic-data layer. Every read and write goes
 *    through `lib/query.ts`, so screens stay fresh on focus, keep rendering while refetching, and
 *    never hand-roll `useEffect` + `fetch`.
 * 2. The `@docket/ui` {@link TooltipProvider} — one shared open/skip-delay timing for every
 *    tooltip in the console, matching the product app's 400ms.
 * 3. The {@link ImpersonationProvider} — tracks the operator's active "viewing as" session so the
 *    persistent banner can render across every route.
 *
 * Both are Client Components, so this file carries the `'use client'` boundary and is mounted once
 * by the root layout. The admin console deliberately omits the product app's org/vocabulary
 * context — it is operator tooling, not a tenant surface.
 *
 * The query client is built in a lazy `useState` initializer rather than at module scope: a
 * module-level client would be shared across requests during SSR, leaking one operator's cached
 * reads into another's render.
 */
export function Providers({ children }: ProvidersProps): JSX.Element {
  const [queryClient] = useState(() => createQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={400}>
        <ImpersonationProvider>{children}</ImpersonationProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
