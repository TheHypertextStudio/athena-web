'use client';

import { useQueryClient } from '@tanstack/react-query';
import { type JSX, type ReactNode, useEffect } from 'react';

import ActionDomainsProvider from '@/components/actions/action-domains-provider';
import { PickerOverlayProvider } from '@/components/pickers/picker-overlay';
import { InteractionProvider } from '@/lib/actions';
import { InteractionReceiptProvider } from '@/lib/interactions/receipt-context';
import {
  invalidateWorkTargetQueriesFromPeer,
  subscribeWorkTargetInvalidations,
} from '@/lib/work-target-invalidation';

import { InPageSearchProvider } from './in-page-search/in-page-search-provider';

/**
 * Interaction providers needed by authenticated application routes, but not by public/auth routes.
 *
 * Keeping this boundary below the `(app)` layout prevents sign-in and onboarding from compiling
 * every object-action domain, picker, editor, and authenticated workspace component before the
 * browser can finish a login transition.
 */
export function AppProviders({ children }: { children: ReactNode }): JSX.Element {
  return (
    <>
      <WorkTargetInvalidationSync />
      <InteractionReceiptProvider>
        <InteractionProvider>
          <PickerOverlayProvider>
            <ActionDomainsProvider>
              <InPageSearchProvider>{children}</InPageSearchProvider>
            </ActionDomainsProvider>
          </PickerOverlayProvider>
        </InteractionProvider>
      </InteractionReceiptProvider>
    </>
  );
}

/** Keep mounted work rosters current when another tab changes their source records. */
function WorkTargetInvalidationSync(): null {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      subscribeWorkTargetInvalidations((invalidation) => {
        void invalidateWorkTargetQueriesFromPeer(queryClient, invalidation);
      }),
    [queryClient],
  );
  return null;
}
