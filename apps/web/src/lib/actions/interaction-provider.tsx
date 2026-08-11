'use client';

/**
 * `lib/actions/interaction-provider` — the one wrapper the app tree needs.
 *
 * @remarks
 * Composes the three halves of the interaction contract in the order they depend on each other:
 *
 * 1. {@link ActionRegistryProvider} — the universal action handler. Everything else dispatches
 *    through it, so it is outermost.
 * 2. {@link DragProvider} — remembers what is currently being dragged, because native HTML5 drag
 *    refuses to say.
 * 3. {@link ObjectContextMenuProvider} — installs the app's single document-level `contextmenu`
 *    listener, which asks the registry what a right-clicked object can do.
 *
 * Mount exactly one, as high in the authenticated tree as possible, so that every surface below
 * shares one registry, one drag record, and one right-click handler. Mounting a second would give
 * two registries and two menus, which is the failure mode this whole contract exists to prevent —
 * hence the composition being a single component rather than three the app wires by hand.
 *
 * Selection is deliberately *not* here: a selection is per-list, not per-app, so each list-like
 * view mounts its own `SelectionProvider`.
 *
 * @example
 * ```tsx
 * // components/providers.tsx
 * <QueryClientProvider client={queryClient}>
 *   <InteractionProvider>
 *     <ServiceWorkerProvider>{children}</ServiceWorkerProvider>
 *   </InteractionProvider>
 * </QueryClientProvider>
 * ```
 */
import { type JSX, type ReactNode, useMemo } from 'react';

import { ObjectContextMenuProvider } from '@/components/context-menu/object-context-menu';
import { DragProvider } from '@/components/dnd/drag-context';
import { createRuntimeWatchdog } from '@/lib/interactions/runtime-watchdog';
import { useOptionalInteractionReceipts } from '@/lib/interactions/receipt-context';

import { ActionRegistryProvider } from './registry-context';
import type { ActionReceiptRuntime, ActionRegistry } from './registry';
import type { ActionId, ActionInvocationResult } from './types';

/** Props for {@link InteractionProvider}. */
export interface InteractionProviderProps {
  /** The app subtree that shares this registry, drag record, and right-click handler. */
  readonly children: ReactNode;
  /** An injected registry, for tests that need to inspect registrations directly. */
  readonly registry?: ActionRegistry;
  /**
   * Observe every action invocation's outcome.
   *
   * @remarks
   * The seam where a failed action becomes user-visible copy. Deliberately left to the app: error
   * copy is application-owned, and an exception's own message must never reach the screen.
   */
  readonly onActionResult?: (id: ActionId, result: ActionInvocationResult) => void;
}

/** Build the registry bridge without exposing receipt correlation outside the client tree. */
function useActionReceiptRuntime(): ActionReceiptRuntime | undefined {
  const receipts = useOptionalInteractionReceipts();
  const watchdog = useMemo(
    () =>
      createRuntimeWatchdog({
        onFailure: (failure) => {
          console.error(`Interaction watchdog: ${failure.code} (${failure.actionId}).`);
        },
      }),
    [],
  );

  return useMemo(() => {
    if (receipts === null) return undefined;
    return {
      begin: (responsiveness, parentInvocationId) => {
        if (responsiveness.ownership === 'autonomous') return undefined;
        if (responsiveness.ownership === 'child') return parentInvocationId;
        return receipts.startInteraction({
          interactionId: responsiveness.interactionId,
          category: responsiveness.category,
          routeTemplateId: responsiveness.routeTemplateId,
        }).invocationId;
      },
      observeAsync: (actionId, invocationId, responsiveness) => {
        if (responsiveness?.ownership === 'autonomous') {
          return watchdog.observeAsync(actionId, { autonomous: true });
        }
        if (invocationId === undefined) return watchdog.observeAsync(actionId, undefined);
        return watchdog.observeAsync(actionId, {
          invocationId,
          isAcknowledged: () => {
            const phase = receipts.receiptFor(invocationId)?.phase;
            return phase === 'acknowledged' || phase === 'progressing';
          },
        });
      },
    };
  }, [receipts, watchdog]);
}

/**
 * Install the app's interaction contract: actions, drag, and the object context menu.
 *
 * @param props - The subtree, plus optional test/observability seams.
 * @returns The composed provider element.
 */
export function InteractionProvider({
  children,
  registry,
  onActionResult,
}: InteractionProviderProps): JSX.Element {
  const receiptRuntime = useActionReceiptRuntime();
  return (
    <ActionRegistryProvider
      {...(registry === undefined ? {} : { registry })}
      {...(receiptRuntime === undefined ? {} : { receiptRuntime })}
      {...(onActionResult === undefined ? {} : { onResult: onActionResult })}
    >
      <DragProvider>
        <ObjectContextMenuProvider>{children}</ObjectContextMenuProvider>
      </DragProvider>
    </ActionRegistryProvider>
  );
}
