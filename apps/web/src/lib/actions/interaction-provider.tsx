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
import type { JSX, ReactNode } from 'react';

import { ObjectContextMenuProvider } from '@/components/context-menu/object-context-menu';
import { DragProvider } from '@/components/dnd/drag-context';

import { ActionRegistryProvider } from './registry-context';
import type { ActionRegistry } from './registry';
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
  return (
    <ActionRegistryProvider
      {...(registry === undefined ? {} : { registry })}
      {...(onActionResult === undefined ? {} : { onResult: onActionResult })}
    >
      <DragProvider>
        <ObjectContextMenuProvider>{children}</ObjectContextMenuProvider>
      </DragProvider>
    </ActionRegistryProvider>
  );
}
