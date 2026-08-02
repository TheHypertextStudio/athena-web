/**
 * `lib/actions/types` — the vocabulary of the universal action handler.
 *
 * @remarks
 * Every user-invocable action in Docket — assign a task, move it to a project, link a project to a
 * calendar event, archive a cycle, switch workspace — is one {@link ActionDefinition} registered
 * once by its domain, and is thereafter invocable from anywhere: a button, the right-click menu,
 * the command palette, a keyboard shortcut, or a drop.
 *
 * The load-bearing idea is **context injection at the call site**. A definition does not capture
 * *what* it operates on; it declares what it can operate on and receives the objects at invoke
 * time through a caller-supplied callback ({@link ActionContextResolver}). That is what makes one
 * definition serve five entry points: the context menu resolves to the right-clicked object, the
 * palette resolves to the current selection, a shortcut resolves to the focused row — and none of
 * them needs its own copy of the action.
 *
 * @see {@link ./registry} for the registry that stores and resolves these.
 */
import type { LucideIcon } from '@docket/ui/icons';

import type { ObjectKind, ObjectMeta, ObjectRef } from './object';

/**
 * A domain of the app, each of which registers its actions exactly once.
 *
 * @remarks
 * The closed set is the enforcement: a new surface cannot invent a domain to register a second
 * copy of an existing action under. `app` covers actions that belong to no entity (open settings,
 * sign out, toggle density).
 */
export type ActionDomain =
  | 'task'
  | 'project'
  | 'initiative'
  | 'program'
  | 'cycle'
  | 'calendar'
  | 'workspace'
  | 'athena'
  | 'app';

/**
 * A stable action identifier, always `<domain>.<verb>`.
 *
 * @remarks
 * The prefix is validated at registration, so an id can never drift from the domain that owns it
 * and every id is greppable back to exactly one registration module.
 */
export type ActionId = `${ActionDomain}.${string}`;

/** Where an invocation came from — recorded so an action can adapt without new definitions. */
export type ActionSource =
  | 'context-menu'
  | 'command-palette'
  | 'shortcut'
  | 'button'
  | 'drag'
  | 'bulk-bar'
  | 'detail';

/**
 * Where an action is grouped when it is listed.
 *
 * @remarks
 * Purely presentational; the menu and the palette render sections in this order and separate them.
 * `danger` is always last and always separated.
 */
export type ActionSection = 'primary' | 'organize' | 'schedule' | 'share' | 'danger';

/** The order sections are rendered in, wherever a resolved action list is displayed. */
export const ACTION_SECTION_ORDER: readonly ActionSection[] = [
  'primary',
  'organize',
  'schedule',
  'share',
  'danger',
];

/**
 * The context one invocation runs against.
 *
 * @remarks
 * Built fresh at every call site, at invoke time. `objects` is empty for a global action and holds
 * more than one entry when the invocation came from a multi-row selection or a bulk bar.
 */
export interface ActionContext {
  /** The objects this invocation operates on — the *subjects*, in the order the user sees them. */
  readonly objects: readonly ObjectRef[];
  /** Which entry point invoked it. */
  readonly source: ActionSource;
  /** The workspace the invocation happened in, or `null` outside a workspace. */
  readonly organizationId: string | null;
  /** The selection surface the invocation came from, when it came from one. */
  readonly surfaceId?: string;
  /**
   * The object the action is aimed *at*, when it has one.
   *
   * @remarks
   * The destination half of a relational action: the project a task was dropped on, the time block
   * it was dragged into, the calendar event a project is being associated with. Keeping subjects
   * and target apart is what lets one definition serve a drop, a picker, and a menu — the drop
   * fills `target` from the element under the pointer, the picker from the chosen row.
   */
  readonly target?: ObjectRef;
  /**
   * Scalar parameters the entry point supplies that are not objects.
   *
   * @remarks
   * A dropped-on date, a slot start time, a chosen status. Constrained to JSON scalars so a
   * context stays inspectable and loggable.
   */
  readonly params?: ObjectMeta;
}

/**
 * A call site's promise to produce a context when the action actually runs.
 *
 * @remarks
 * A callback rather than a value, deliberately. The palette lists actions against the selection as
 * it stands when the list is drawn, but must operate on the selection as it stands when the row is
 * chosen — those differ the moment anything changes underneath. Resolving late is the difference
 * between acting on what the user sees and acting on a stale snapshot.
 */
export type ActionContextResolver = () => ActionContext;

/**
 * One action, defined once by its domain.
 *
 * @remarks
 * `run` is the only side-effecting member. Everything else is a pure question the registry asks in
 * order to decide whether to offer the action and how to label it.
 */
export interface ActionDefinition {
  /** Stable id, `<domain>.<verb>`; must be prefixed by {@link ActionDefinition.domain}. */
  readonly id: ActionId;
  /** The domain that owns and registers this action. */
  readonly domain: ActionDomain;
  /**
   * The label shown wherever the action is listed.
   *
   * @remarks
   * A function when the label depends on the context ("Move 3 tasks to…" vs "Move task to…").
   * This is application-owned copy: it must never interpolate a provider or exception message.
   */
  readonly label: string | ((context: ActionContext) => string);
  /** Leading glyph. Defaults to the object kind's descriptor icon when omitted. */
  readonly icon?: LucideIcon;
  /** Grouping for menus and the palette. Defaults to `'primary'`. */
  readonly section?: ActionSection;
  /** Extra terms the command palette's fuzzy filter matches against. */
  readonly keywords?: readonly string[];
  /** Human-readable shortcut hint, e.g. `'⌘⌫'`. Display only; binding lives with the surface. */
  readonly shortcutHint?: string;
  /**
   * The object kinds this action operates on.
   *
   * @remarks
   * When present, the action is only offered for a context whose objects are *all* of these kinds,
   * and never for an empty context. Omit for a global action (one that needs no object).
   */
  readonly objectKinds?: readonly ObjectKind[];
  /** Whether the action can operate on more than one object at once. Defaults to `false`. */
  readonly multi?: boolean;
  /** Marks a destructive action, so surfaces can tone it and place it last. */
  readonly destructive?: boolean;
  /**
   * An extra applicability test beyond the kind/arity checks.
   *
   * @remarks
   * Return `false` to hide the action entirely — the right answer when offering it would be
   * nonsense ("Remove from project" on a task that has no project). To show it but block it, use
   * {@link ActionDefinition.disabledReason} instead, so the user learns why.
   */
  readonly appliesTo?: (context: ActionContext) => boolean;
  /**
   * Why the action is currently unavailable, or `null` when it is available.
   *
   * @remarks
   * A non-null return renders the item disabled *with this sentence attached*. There is no way to
   * disable an item without saying why, which is what keeps inert placeholder items out of menus.
   * Application-owned copy, same rule as {@link ActionDefinition.label}.
   */
  readonly disabledReason?: (context: ActionContext) => string | null;
  /** Perform the action. May be async; the registry awaits it and reports the outcome. */
  readonly run: (context: ActionContext) => void | Promise<void>;
}

/** What happened when an action was invoked. */
export type ActionInvocationResult =
  | { readonly status: 'ran' }
  | {
      readonly status: 'skipped';
      /** Why it did not run. */
      readonly reason: 'not-applicable' | 'disabled';
      /** The action's own explanation when it was disabled, else `null`. */
      readonly detail: string | null;
    }
  | { readonly status: 'failed'; readonly error: unknown };

/**
 * An action resolved against a concrete context, ready to render and invoke.
 *
 * @remarks
 * The label and disabled state are already evaluated, so a menu renders one of these without
 * knowing anything about the definition. {@link ResolvedAction.invoke} re-resolves the context
 * through the original callback, so a stale list still acts on current state.
 */
export interface ResolvedAction {
  /** The action's stable id. */
  readonly id: ActionId;
  /** The definition this came from, for surfaces needing more than the resolved fields. */
  readonly definition: ActionDefinition;
  /** The evaluated label. */
  readonly label: string;
  /** The glyph to render. */
  readonly icon: LucideIcon;
  /** The section to group under. */
  readonly section: ActionSection;
  /** Display-only shortcut hint, when the action has one. */
  readonly shortcutHint: string | null;
  /** Whether the action is destructive. */
  readonly destructive: boolean;
  /** The reason the action is unavailable, or `null` when it is available. */
  readonly disabledReason: string | null;
  /** Run it, re-resolving the context first. */
  readonly invoke: () => Promise<ActionInvocationResult>;
}
