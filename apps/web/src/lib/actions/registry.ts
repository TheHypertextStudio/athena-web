/**
 * `lib/actions/registry` — the universal action handler.
 *
 * @remarks
 * One registry holds every user-invocable action in the app. Surfaces do not own actions; they
 * *dispatch* them. That inversion is what makes "the command palette can do anything a button can
 * do" true by construction rather than by discipline: a new action is registered once by its
 * domain and is immediately reachable from the palette, the right-click menu, a keyboard shortcut
 * and a drop, with no per-surface wiring.
 *
 * Three invariants are enforced here rather than reviewed for:
 *
 * 1. **Ids are unique.** Every id must be prefixed with its own domain, which makes a cross-domain
 *    collision unspellable, and a repeat inside one domain throws in development. Together they
 *    mean any id greps back to exactly one registration module.
 * 2. **A domain registers exactly once.** {@link ActionRegistry.register} is keyed by domain and
 *    *replaces* that domain's bucket, so re-registering the same definitions (a remount, a
 *    navigation, React's strict-mode double invocation) leaves the registry byte-identical.
 *    Registering the *same* domain from a second module with *different* definitions throws,
 *    which is what stops a second registration module from appearing.
 * 3. **Invocation is honest.** Invoking an action that does not apply, or that the definition
 *    itself says is unavailable, does not silently do nothing and does not pretend to succeed — it
 *    returns a `skipped` result carrying the reason. A thrown error surfaces as `failed` with the
 *    original error, never swallowed.
 *
 * The registry is a plain object with no React dependency, so it is unit-testable as data.
 * {@link ./registry-context} mounts one for the app.
 */
import { describeObject } from './object';
import {
  ACTION_SECTION_ORDER,
  type ActionContext,
  type ActionContextResolver,
  type ActionDefinition,
  type ActionDomain,
  type ActionId,
  type ActionInvocationResult,
  type ActionDefinitionInput,
  type ActionResponsiveness,
  type ActionSection,
  type ResolvedAction,
  type ValidActionDefinition,
} from './types';

/** Runtime seam that owns receipt activation and development/test watchdog observation. */
export interface ActionReceiptRuntime {
  /** Start a root receipt or reuse a parent receipt; returns its local-only correlation value. */
  readonly begin: (
    responsiveness: ActionResponsiveness,
    parentInvocationId: string | undefined,
  ) => string | undefined;
  /** Observe promise-returning work without putting correlation values into diagnostics. */
  readonly observeAsync: (
    actionId: ActionId,
    invocationId: string | undefined,
    responsiveness: ActionResponsiveness | undefined,
  ) => ActionAsyncObservation | undefined;
  /** Settle a receipt that was activated for an invalid synchronous runtime edge. */
  readonly abandon?: (invocationId: string) => void;
}

/** Cleanup and settlement hooks returned by an {@link ActionReceiptRuntime} observation. */
export interface ActionAsyncObservation {
  /** Stop a pending development/test watchdog observation. */
  readonly cleanup: () => void;
  /** Finish observation without treating asynchronous settlement as painted acknowledgement. */
  readonly settle: () => void;
}

/** Construction options for {@link createActionRegistry}. */
export interface ActionRegistryOptions {
  /** Optional receipt/runtime bridge, mounted only in the client provider tree. */
  readonly receiptRuntime?: ActionReceiptRuntime;
}

/** Apply return-shape validation to tuple entries without widening them through the array index. */
type ValidatedActionDefinitions<Actions extends readonly ActionDefinitionInput[]> = {
  readonly [Index in keyof Actions]: Index extends `${number}`
    ? ValidActionDefinition<Actions[Index]>
    : Actions[Index];
};

/** Thrown when one domain declares the same action id twice. */
export class DuplicateActionIdError extends Error {
  /** The id that was declared twice. */
  readonly actionId: ActionId;
  /** The domain that declared it. */
  readonly ownedBy: ActionDomain;

  /**
   * @param actionId - The colliding id.
   * @param ownedBy - The domain that declared it.
   */
  constructor(actionId: ActionId, ownedBy: ActionDomain) {
    super(`Action id "${actionId}" is already registered by the "${ownedBy}" domain.`);
    this.name = 'DuplicateActionIdError';
    this.actionId = actionId;
    this.ownedBy = ownedBy;
  }
}

/** Thrown when a second module tries to register a domain that another module already owns. */
export class DuplicateDomainRegistrationError extends Error {
  /** The domain registered twice. */
  readonly domain: ActionDomain;

  /** @param domain - The domain that already has a registration module. */
  constructor(domain: ActionDomain) {
    super(
      `The "${domain}" domain is already registered with a different action set. Each domain registers its actions exactly once, from one module.`,
    );
    this.name = 'DuplicateDomainRegistrationError';
    this.domain = domain;
  }
}

/** Thrown when an id is dispatched that nothing ever registered — always a programming error. */
export class UnknownActionError extends Error {
  /** The id that was dispatched. */
  readonly actionId: string;

  /** @param actionId - The unregistered id. */
  constructor(actionId: string) {
    super(`No action is registered under the id "${actionId}".`);
    this.name = 'UnknownActionError';
    this.actionId = actionId;
  }
}

/** Thrown when a definition's id does not begin with its own domain. */
export class MalformedActionIdError extends Error {
  /** @param actionId - The offending id. @param domain - The domain that declared it. */
  constructor(actionId: string, domain: ActionDomain) {
    super(`Action id "${actionId}" must be prefixed with its domain ("${domain}.").`);
    this.name = 'MalformedActionIdError';
  }
}

/** A point-in-time description of everything the registry holds. */
export interface ActionRegistrySnapshot {
  /** How many actions are registered. */
  readonly count: number;
  /** Every registered id, sorted, so two snapshots compare by value. */
  readonly ids: readonly ActionId[];
  /** Every domain that has registered, sorted. */
  readonly domains: readonly ActionDomain[];
}

/** The universal action handler. */
export interface ActionRegistry {
  /**
   * Register a domain's complete action set.
   *
   * @remarks
   * Re-registering the *same* array is refcounted and leaves the registry unchanged. Registering a
   * *different* array for an already-registered domain throws in development and replaces it in
   * production, so a mistake is loud where it can be fixed and non-fatal where it cannot.
   *
   * @param domain - The registering domain.
   * @param definitions - Its complete, stable action list. Pass a module-level constant so
   *   re-registration is recognized as identical.
   * @returns A function that removes the domain's registration.
   * @throws {@link DuplicateActionIdError} when the same id appears twice in the set (development).
   * @throws {@link DuplicateDomainRegistrationError} when a different module already registered
   *   this domain (development).
   * @throws {@link MalformedActionIdError} when an id is not prefixed with its domain.
   */
  register: (domain: ActionDomain, definitions: readonly ActionDefinition[]) => () => void;
  /** Look up a definition by id. */
  get: (id: string) => ActionDefinition | undefined;
  /** Every registered definition, in registration order. */
  list: () => readonly ActionDefinition[];
  /**
   * Resolve every action applicable to a context, ready to render.
   *
   * @param resolveContext - The call site's context callback. Evaluated once now to decide what is
   *   applicable, and again inside each {@link ResolvedAction.invoke}.
   * @returns The applicable actions, grouped by {@link ACTION_SECTION_ORDER} then registration
   *   order.
   */
  resolve: (resolveContext: ActionContextResolver) => readonly ResolvedAction[];
  /**
   * Invoke one action by id.
   *
   * @param id - The action to run.
   * @param resolveContext - The call site's context callback, evaluated now.
   * @throws {@link UnknownActionError} when nothing is registered under the id.
   */
  invoke: (id: ActionId, resolveContext: ActionContextResolver) => Promise<ActionInvocationResult>;
  /** A value-comparable description of the registry's contents. */
  snapshot: () => ActionRegistrySnapshot;
  /**
   * A counter bumped on every registration change.
   *
   * @remarks
   * Exists because `useSyncExternalStore` requires a cached, referentially stable snapshot, which
   * {@link ActionRegistry.snapshot} deliberately is not (it builds a fresh comparable value).
   */
  version: () => number;
  /** Subscribe to registration changes; returns an unsubscribe function. */
  subscribe: (listener: () => void) => () => void;
}

/** One domain's registration record. */
interface DomainRegistration {
  /** The exact array the domain registered, used to recognize an identical re-registration. */
  readonly definitions: readonly ActionDefinition[];
  /**
   * How many live callers hold this registration.
   *
   * @remarks
   * Registration is refcounted so that two mounted components registering the *same* definitions —
   * a domain module rendered on two routes at once, or React's strict-mode double invocation —
   * cannot have one's unmount pull the registration out from under the other. It never permits two
   * *different* sets: that still throws.
   */
  refs: number;
}

/** Whether the strict invariants throw. Off in production so a collision cannot white-screen. */
function strictMode(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/**
 * Decide whether an action applies to a context.
 *
 * @remarks
 * The kind and arity checks are derived from the definition so most actions never write an
 * `appliesTo` at all: declaring `objectKinds: ['task']` already means "one task, and only a task".
 */
function appliesToContext(definition: ActionDefinition, context: ActionContext): boolean {
  const kinds = definition.objectKinds;
  if (kinds !== undefined) {
    if (context.objects.length === 0) return false;
    if (!context.objects.every((object) => kinds.includes(object.kind))) return false;
  }
  if (definition.multi !== true && context.objects.length > 1) return false;
  return definition.appliesTo?.(context) ?? true;
}

/** Evaluate a definition's label against a context. */
function labelFor(definition: ActionDefinition, context: ActionContext): string {
  return typeof definition.label === 'function' ? definition.label(context) : definition.label;
}

/** Choose the glyph: the definition's own, else the icon of the kind it operates on. */
function iconFor(definition: ActionDefinition, context: ActionContext): ResolvedAction['icon'] {
  if (definition.icon !== undefined) return definition.icon;
  const first = context.objects[0];
  if (first !== undefined) return describeObject(first.kind).icon;
  return describeObject('task').icon;
}

/** Rank a section for sorting. Unknown sections sort last, defensively. */
function sectionRank(section: ActionSection): number {
  const index = ACTION_SECTION_ORDER.indexOf(section);
  return index === -1 ? ACTION_SECTION_ORDER.length : index;
}

/**
 * Create an action registry.
 *
 * @remarks
 * One instance is mounted per app by {@link ../actions/registry-context.ActionRegistryProvider}.
 * Tests create their own so registrations never leak between cases.
 *
 * @returns A fresh, empty {@link ActionRegistry}.
 *
 * @example
 * ```ts
 * const registry = createActionRegistry();
 * registry.register('task', TASK_ACTIONS);
 * await registry.invoke('task.complete', () => ({
 *   objects: [task],
 *   source: 'shortcut',
 *   organizationId: orgId,
 * }));
 * ```
 */
export function createActionRegistry(options: ActionRegistryOptions = {}): ActionRegistry {
  const domains = new Map<ActionDomain, DomainRegistration>();
  const listeners = new Set<() => void>();
  let version = 0;

  /** Flatten the per-domain buckets in a stable order. */
  function flatten(): readonly ActionDefinition[] {
    const flat: ActionDefinition[] = [];
    for (const registration of domains.values()) flat.push(...registration.definitions);
    return flat;
  }

  function notify(): void {
    version += 1;
    for (const listener of listeners) listener();
  }

  function register(domain: ActionDomain, definitions: readonly ActionDefinition[]): () => void {
    /** Release one hold on the domain, removing it when the last one goes. */
    function release(): void {
      const held = domains.get(domain);
      if (held?.definitions !== definitions) return;
      held.refs -= 1;
      if (held.refs > 0) return;
      domains.delete(domain);
      notify();
    }

    const existing = domains.get(domain);
    if (existing?.definitions === definitions) {
      // An identical re-registration — a remount, a navigation, or strict-mode's double
      // invocation. The registry's contents must be unchanged afterwards.
      existing.refs += 1;
      return release;
    }
    if (existing !== undefined && strictMode()) {
      throw new DuplicateDomainRegistrationError(domain);
    }

    const seenInBatch = new Set<string>();
    for (const definition of definitions) {
      if (!definition.id.startsWith(`${domain}.`) || definition.domain !== domain) {
        throw new MalformedActionIdError(definition.id, domain);
      }
      if (seenInBatch.has(definition.id) && strictMode()) {
        throw new DuplicateActionIdError(definition.id, domain);
      }
      seenInBatch.add(definition.id);
    }

    domains.set(domain, { definitions, refs: 1 });
    notify();
    return release;
  }

  function get(id: string): ActionDefinition | undefined {
    for (const registration of domains.values()) {
      const found = registration.definitions.find((definition) => definition.id === id);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  async function invoke(
    id: ActionId,
    resolveContext: ActionContextResolver,
  ): Promise<ActionInvocationResult> {
    const definition = get(id);
    if (definition === undefined) throw new UnknownActionError(id);
    const context = resolveContext();
    if (!appliesToContext(definition, context)) {
      return { status: 'skipped', reason: 'not-applicable', detail: null };
    }
    const disabledReason = definition.disabledReason?.(context) ?? null;
    if (disabledReason !== null) {
      return { status: 'skipped', reason: 'disabled', detail: disabledReason };
    }
    const responsiveness = definition.responsiveness;
    const invocationId =
      responsiveness === undefined
        ? undefined
        : responsiveness.ownership === 'child'
          ? context.parentInvocationId
          : options.receiptRuntime?.begin(responsiveness, context.parentInvocationId);
    const actionContext =
      invocationId === undefined ? context : { ...context, parentInvocationId: invocationId };
    let observation: ActionAsyncObservation | undefined;
    let asynchronousWorkStarted = false;
    try {
      const work = definition.run(actionContext);
      if (work instanceof Promise) {
        asynchronousWorkStarted = true;
        if (responsiveness?.ownership !== 'child' || invocationId === undefined) {
          observation =
            options.receiptRuntime?.observeAsync(definition.id, invocationId, responsiveness) ??
            undefined;
        }
        await work;
      } else if (responsiveness?.ownership === 'root' && invocationId !== undefined) {
        options.receiptRuntime?.abandon?.(invocationId);
      }
      return { status: 'ran' };
    } catch (error) {
      if (
        !asynchronousWorkStarted &&
        responsiveness?.ownership === 'root' &&
        invocationId !== undefined
      ) {
        options.receiptRuntime?.abandon?.(invocationId);
      }
      return { status: 'failed', error };
    } finally {
      observation?.settle();
    }
  }

  function resolve(resolveContext: ActionContextResolver): readonly ResolvedAction[] {
    const context = resolveContext();
    const applicable = flatten().filter((definition) => appliesToContext(definition, context));
    return applicable
      .map((definition, order): ResolvedAction & { readonly order: number } => ({
        id: definition.id,
        definition,
        label: labelFor(definition, context),
        icon: iconFor(definition, context),
        section: definition.section ?? 'primary',
        shortcutHint: definition.shortcutHint ?? null,
        destructive: definition.destructive ?? false,
        disabledReason: definition.disabledReason?.(context) ?? null,
        invoke: () => invoke(definition.id, resolveContext),
        order,
      }))
      .sort((a, b) => sectionRank(a.section) - sectionRank(b.section) || a.order - b.order)
      .map(({ order: _order, ...action }) => action);
  }

  function snapshot(): ActionRegistrySnapshot {
    const ids = flatten()
      .map((definition) => definition.id)
      .sort();
    return {
      count: ids.length,
      ids,
      domains: [...domains.keys()].sort(),
    };
  }

  return {
    register,
    get,
    list: flatten,
    resolve,
    invoke,
    snapshot,
    version: () => version,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Declare a domain's action set.
 *
 * @remarks
 * A thin, deliberate wrapper: it stamps the domain onto every definition so an id and its `domain`
 * field can never disagree, and it freezes the array so the identity a module exports is the
 * identity the registry compares against on re-registration. Every registration module's default
 * export should be one of these.
 *
 * @param domain - The domain being defined.
 * @param actions - The domain's actions, without their repeated `domain` field.
 * @returns The complete, frozen definition list.
 *
 * @example
 * ```ts
 * export const TASK_ACTIONS = defineActionDomain('task', [
 *   {
 *     id: 'task.moveToProject',
 *     label: 'Move to project…',
 *     objectKinds: ['task'],
 *     multi: true,
 *     section: 'organize',
 *     run: (context) => { … },
 *   },
 * ]);
 * ```
 */
export function defineActionDomain<const Actions extends readonly ActionDefinitionInput[]>(
  domain: ActionDomain,
  actions: Actions & ValidatedActionDefinitions<Actions>,
): readonly ActionDefinition[] {
  return Object.freeze(
    actions.map((action) => ({ ...action, domain })),
  ) as readonly ActionDefinition[];
}
