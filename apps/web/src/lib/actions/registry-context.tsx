'use client';

/**
 * `lib/actions/registry-context` — the React binding for the universal action handler.
 *
 * @remarks
 * Holds exactly one {@link ActionRegistry} for the app and exposes the three things surfaces need:
 * a way to register a domain's actions once ({@link useRegisterActionDomain}), a way to dispatch
 * one by id ({@link useActionDispatch}), and a way to list the ones applicable right now
 * ({@link useResolvedActions}).
 *
 * The registration hook is the interesting one. It registers on mount and unregisters on unmount,
 * which under React's strict-mode double invocation means register → unregister → register. Since
 * {@link ActionRegistry.register} is keyed by domain and compares the definition array by
 * identity, the registry's contents are identical after that sequence to what they were after the
 * first call — which is the whole reason registration modules must export a module-level constant
 * rather than build their array inline.
 */
import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';

import { type ActionReceiptRuntime, type ActionRegistry, createActionRegistry } from './registry';
import type {
  ActionContextResolver,
  ActionDefinition,
  ActionDomain,
  ActionId,
  ActionInvocationResult,
  ResolvedAction,
} from './types';

/** What the provider publishes to descendants. */
interface ActionRegistryContextValue {
  /** The app's single registry. */
  readonly registry: ActionRegistry;
  /** Optional observer notified after every invocation, for toasts or telemetry. */
  readonly onResult: ((id: ActionId, result: ActionInvocationResult) => void) | undefined;
}

const ActionRegistryContext = createContext<ActionRegistryContextValue | null>(null);

/** Props for {@link ActionRegistryProvider}. */
export interface ActionRegistryProviderProps {
  /** The subtree that can register and dispatch actions. */
  readonly children: ReactNode;
  /**
   * A registry to use instead of a fresh one.
   *
   * @remarks
   * Only for tests and stories, which need to inspect the registry directly. The app always lets
   * the provider create its own, so there is exactly one.
   */
  readonly registry?: ActionRegistry;
  /** Receipt bridge used by the provider-created production registry. */
  readonly receiptRuntime?: ActionReceiptRuntime;
  /**
   * Observe every invocation's outcome.
   *
   * @remarks
   * The seam where a `failed` result becomes user-visible copy. The provider deliberately does not
   * render anything itself: error copy is application-owned and surface-specific, and an exception
   * message must never be shown, so the decision belongs to the app, not to this module.
   */
  readonly onResult?: (id: ActionId, result: ActionInvocationResult) => void;
}

/**
 * Mount the app's single action registry.
 *
 * @param props - The subtree, and optionally an injected registry or result observer.
 * @returns The provider element.
 */
export function ActionRegistryProvider({
  children,
  registry,
  receiptRuntime,
  onResult,
}: ActionRegistryProviderProps): JSX.Element {
  const [ownRegistry] = useState(() => registry ?? createActionRegistry({ receiptRuntime }));
  const value = useMemo<ActionRegistryContextValue>(
    () => ({ registry: registry ?? ownRegistry, onResult }),
    [registry, ownRegistry, onResult],
  );
  return <ActionRegistryContext.Provider value={value}>{children}</ActionRegistryContext.Provider>;
}

/** Thrown when an action hook is used outside {@link ActionRegistryProvider}. */
class MissingActionRegistryError extends Error {
  constructor() {
    super(
      'No action registry is mounted. Wrap the tree in <InteractionProvider> (or <ActionRegistryProvider>).',
    );
    this.name = 'MissingActionRegistryError';
  }
}

/** Read the mounted context, or explain precisely what is missing. */
function useActionRegistryContext(): ActionRegistryContextValue {
  const value = useContext(ActionRegistryContext);
  if (value === null) throw new MissingActionRegistryError();
  return value;
}

/**
 * The app's action registry.
 *
 * @returns The mounted {@link ActionRegistry}.
 * @throws When no {@link ActionRegistryProvider} is mounted above.
 */
export function useActionRegistry(): ActionRegistry {
  return useActionRegistryContext().registry;
}

/**
 * Register one domain's actions for as long as the calling component is mounted.
 *
 * @remarks
 * Call this once, from the one module that owns the domain, with a module-level constant array.
 * Passing a freshly-built array on every render is a bug the registry will report as a duplicate
 * domain registration.
 *
 * @param domain - The domain being registered.
 * @param definitions - Its complete, stable action list (a module-level constant).
 *
 * @example
 * ```tsx
 * // components/tasks/task-actions.tsx — the ONE place task actions are declared.
 * export function TaskActionRegistration(): null {
 *   useRegisterActionDomain('task', TASK_ACTIONS);
 *   return null;
 * }
 * ```
 */
export function useRegisterActionDomain(
  domain: ActionDomain,
  definitions: readonly ActionDefinition[],
): void {
  const registry = useActionRegistry();
  useEffect(() => registry.register(domain, definitions), [registry, domain, definitions]);
}

/**
 * Dispatch an action by id, injecting the context from this call site.
 *
 * @returns A dispatch function taking the action id and a context callback.
 *
 * @example
 * ```tsx
 * const dispatch = useActionDispatch();
 * <Button onClick={() => { dispatch('task.complete', () => ({
 *   objects: [task], source: 'button', organizationId: orgId,
 * })); }}>Complete</Button>
 * ```
 */
export function useActionDispatch(): (
  id: ActionId,
  resolveContext: ActionContextResolver,
) => Promise<ActionInvocationResult> {
  const { registry, onResult } = useActionRegistryContext();
  return useCallback(
    async (id, resolveContext) => {
      const result = await registry.invoke(id, resolveContext);
      onResult?.(id, result);
      return result;
    },
    [registry, onResult],
  );
}

/** Optional action dispatch for interaction affordances that degrade inertly in isolation. */
export function useOptionalActionDispatch():
  | ((id: ActionId, resolveContext: ActionContextResolver) => Promise<ActionInvocationResult>)
  | null {
  const value = useContext(ActionRegistryContext);
  return useMemo(() => {
    if (value === null) return null;
    return async (id: ActionId, resolveContext: ActionContextResolver) => {
      const result = await value.registry.invoke(id, resolveContext);
      value.onResult?.(id, result);
      return result;
    };
  }, [value]);
}

/**
 * Every registered action applicable to a context, ready to render.
 *
 * @remarks
 * Re-resolves whenever the registry changes or `resolveContext` changes identity, so the caller
 * controls staleness by memoizing (or not memoizing) its callback. Each returned action's
 * `invoke` re-reads the context at click time regardless.
 *
 * @param resolveContext - The call site's context callback; memoize it with `useCallback`.
 * @returns The applicable actions, grouped and ordered for display.
 */
export function useResolvedActions(
  resolveContext: ActionContextResolver,
): readonly ResolvedAction[] {
  const { registry, onResult } = useActionRegistryContext();
  const registryVersion = useSyncExternalStore(
    registry.subscribe,
    registry.version,
    registry.version,
  );
  return useMemo(() => {
    const resolved = registry.resolve(resolveContext);
    if (onResult === undefined) return resolved;
    return resolved.map((action) => ({
      ...action,
      invoke: async () => {
        const result = await action.invoke();
        onResult(action.id, result);
        return result;
      },
    }));
    // `registryVersion` participates so a late domain registration re-resolves the list.
  }, [registry, resolveContext, onResult, registryVersion]);
}
