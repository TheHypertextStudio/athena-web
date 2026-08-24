/**
 * `lib/actions/object` — the one first-class descriptor every core Docket object is read through.
 *
 * @remarks
 * Docket's premise is that a task, a project, an initiative, a program, a cycle, a calendar event
 * and a time block are all *the same kind of thing* to the interaction layer: something you can
 * pick up, right-click, select, and act on. Before this module each surface re-invented that
 * knowledge — the calendar built its own drag payload, the triage row hardcoded its own menu, and
 * every table invented its own row key. Three copies of "what is this object" means three places
 * to forget one.
 *
 * So the vocabulary lives here, exactly once:
 *
 * - {@link ObjectKind} — the closed set of core kinds. Adding a kind is a one-line change here and
 *   a type error everywhere that must handle it.
 * - {@link ObjectRef} — the serializable identity of one object in flight (dragged, right-clicked,
 *   selected). It is deliberately *not* the object's full record: the interaction layer only ever
 *   needs enough to name it, scope it, and act on it.
 * - {@link OBJECT_DESCRIPTORS} — per-kind presentation and capability facts (icon, noun,
 *   selectable, draggable) that drag, menus, and selection all read rather than restate.
 * - {@link objectKey} — the single selection/React key derivation, so two surfaces never disagree
 *   about whether they are pointing at the same object.
 * - {@link objectTargetProps} / {@link readObjectTarget} — the DOM bridge. An element that carries
 *   these attributes *is* that object as far as the global right-click handler is concerned, which
 *   is what lets one document-level listener serve every surface without importing any of them.
 *
 * This module is deliberately free of React and of `@docket/api`, so it can be unit-tested as pure
 * data and imported from anywhere (server components included).
 *
 * @see {@link ../../components/dnd} for the drag machinery that carries an {@link ObjectRef}.
 * @see {@link ../../components/context-menu} for the global right-click handler that reads one.
 * @see {@link ../../components/selection} for the selection model keyed by {@link objectKey}.
 */
import {
  Calendar,
  Flag,
  FolderKanban,
  GanttChart,
  Layers,
  ListChecks,
  type LucideIcon,
  Schedule,
  Tag,
  Target,
  Users,
  User,
} from '@docket/ui/icons';
import type { Health, Priority } from '@docket/types';
import type { PlanningTimeframe } from '@docket/work/planning-timeframe';

/**
 * Every core data type the app treats as a first-class object.
 *
 * @remarks
 * `calendar_event` is an item on a connected or native calendar; `time_block` is a scheduled span
 * of the viewer's own time (a timebox). They are separate kinds because they answer to different
 * verbs — you *attend* an event and you *spend* a block — and because a task dropped on one means
 * something different than a task dropped on the other.
 */
export type ObjectKind =
  | 'task'
  | 'project'
  | 'initiative'
  | 'initiative_root'
  | 'program'
  | 'cycle'
  | 'calendar_event'
  | 'time_block'
  | 'team'
  | 'milestone'
  | 'actor'
  | 'label'
  | 'calendar_slot';

/**
 * Extra, kind-specific facts an object carries alongside its identity.
 *
 * @remarks
 * Constrained to domain scalars because the pure relation catalog validates these facts without
 * importing application records. Anything richer belongs in the record the action fetches by id.
 */
export type ObjectMeta = Readonly<Record<string, string | number | boolean | null>>;

/**
 * The identity of one object as the interaction layer sees it.
 *
 * @remarks
 * `organizationId` is nullable because personal-workspace calendar events and time blocks are not
 * org-scoped. Drop targets use it to reject cross-workspace moves, so it must be present whenever
 * the object genuinely belongs to a workspace.
 */
export interface ObjectRef {
  /** Which core data type this is. */
  readonly kind: ObjectKind;
  /** Stable record id. */
  readonly id: string;
  /** The workspace this object belongs to, or `null` when it is personal/unscoped. */
  readonly organizationId: string | null;
  /** Human-readable label — the menu heading, the drag's `text/plain`, the checkbox's name. */
  readonly title: string;
  /** Kind-specific extras a drop target or action needs (e.g. an initiative's parent edge). */
  readonly meta?: ObjectMeta;
}

/** Every Task value the canvas bulk Properties editor may replace. */
export interface CanvasTaskPropertySnapshot {
  readonly kind: 'task';
  readonly id: string;
  readonly organizationId: string;
  readonly state: string;
  readonly priority: Priority;
  readonly assigneeId: string | null;
  readonly projectId: string | null;
  readonly programId: string | null;
  readonly milestoneId: string | null;
  readonly cycleId: string | null;
  readonly labelIds: readonly string[];
  readonly teamId: string;
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly estimate: number | null;
}

/** Every Project value the canvas bulk Properties editor may replace. */
export interface CanvasProjectPropertySnapshot {
  readonly kind: 'project';
  readonly id: string;
  readonly organizationId: string;
  readonly status: string;
  readonly health: Health | null;
  readonly priority: Priority;
  readonly leadId: string | null;
  readonly teamId: string | null;
  readonly programId: string | null;
  readonly labelIds: readonly string[];
  readonly initiativeIds: readonly string[];
  readonly startTimeframe: PlanningTimeframe | null;
  readonly targetTimeframe: PlanningTimeframe | null;
}

/** Full property state carried beside scalar-only {@link ObjectRef} interaction identity. */
export type CanvasPropertySnapshot = CanvasTaskPropertySnapshot | CanvasProjectPropertySnapshot;

/** The presentation and capability facts one {@link ObjectKind} publishes. */
export interface ObjectDescriptor {
  /** The kind this describes. */
  readonly kind: ObjectKind;
  /**
   * The neutral singular noun.
   *
   * @remarks
   * A fallback, not the display label. Kinds that are org-skinnable carry {@link vocabularyKey};
   * surfaces that render a noun to a person must resolve it through `useVocabulary` so an org's
   * renamed "Program" (an agency's "Retainer") is honored.
   */
  readonly noun: string;
  /** The neutral plural noun, under the same caveat as {@link noun}. */
  readonly pluralNoun: string;
  /**
   * The `@docket/ui` vocabulary key for kinds an org may rename, or `null` for kinds it may not.
   *
   * @remarks
   * Calendar events and time blocks are platform concepts, not Docket domain nouns, so they are
   * deliberately not skinnable.
   */
  readonly vocabularyKey: 'initiative' | 'program' | 'project' | 'task' | 'cycle' | 'team' | null;
  /** The glyph every surface uses for this kind — menus, drag ghosts, empty states. */
  readonly icon: LucideIcon;
  /** Whether an instance may be picked up and dropped somewhere else. */
  readonly draggable: boolean;
  /** Whether instances may participate in multi-select in a list-like view. */
  readonly selectable: boolean;
  /**
   * The {@link ObjectMeta} keys this kind is expected to carry, documented so a drop target knows
   * what it may read. Empty for kinds whose identity is sufficient.
   */
  readonly metaKeys: readonly string[];
}

/**
 * Every core data type, described exactly once.
 *
 * @remarks
 * Typed as a total map over {@link ObjectKind}, so adding a kind without describing it is a
 * compile error rather than a runtime hole. Nothing may construct a drag payload, a menu item
 * list, or a selection key without coming through here.
 */
export const OBJECT_DESCRIPTORS: Readonly<Record<ObjectKind, ObjectDescriptor>> = {
  task: {
    kind: 'task',
    noun: 'Task',
    pluralNoun: 'Tasks',
    vocabularyKey: 'task',
    icon: ListChecks,
    draggable: true,
    selectable: true,
    metaKeys: ['projectId', 'cycleId', 'assigneeId', 'parentTaskId'],
  },
  project: {
    kind: 'project',
    noun: 'Project',
    pluralNoun: 'Projects',
    vocabularyKey: 'project',
    icon: FolderKanban,
    draggable: true,
    selectable: true,
    metaKeys: ['programId', 'targetDate'],
  },
  initiative: {
    kind: 'initiative',
    noun: 'Initiative',
    pluralNoun: 'Initiatives',
    vocabularyKey: 'initiative',
    icon: Target,
    draggable: true,
    selectable: true,
    // The hierarchy treegrid re-parents by moving an edge, so the edge travels with the drag.
    metaKeys: ['parentInitiativeId', 'parentLinkId'],
  },
  initiative_root: {
    kind: 'initiative_root',
    noun: 'Initiative top level',
    pluralNoun: 'Initiative top levels',
    vocabularyKey: null,
    icon: Target,
    draggable: false,
    selectable: false,
    metaKeys: [],
  },
  program: {
    kind: 'program',
    noun: 'Program',
    pluralNoun: 'Programs',
    vocabularyKey: 'program',
    icon: Layers,
    draggable: true,
    selectable: true,
    metaKeys: ['initiativeId'],
  },
  cycle: {
    kind: 'cycle',
    noun: 'Cycle',
    pluralNoun: 'Cycles',
    vocabularyKey: 'cycle',
    icon: GanttChart,
    draggable: true,
    selectable: true,
    metaKeys: ['startsAt', 'endsAt'],
  },
  calendar_event: {
    kind: 'calendar_event',
    noun: 'Event',
    pluralNoun: 'Events',
    vocabularyKey: null,
    icon: Calendar,
    draggable: true,
    selectable: true,
    metaKeys: ['calendarId', 'startsAt', 'endsAt', 'allDay'],
  },
  time_block: {
    kind: 'time_block',
    noun: 'Time block',
    pluralNoun: 'Time blocks',
    vocabularyKey: null,
    icon: Schedule,
    draggable: true,
    selectable: true,
    metaKeys: ['startsAt', 'endsAt', 'taskId'],
  },
  team: {
    kind: 'team',
    noun: 'Team',
    pluralNoun: 'Teams',
    vocabularyKey: 'team',
    icon: Users,
    draggable: false,
    selectable: true,
    metaKeys: [],
  },
  milestone: {
    kind: 'milestone',
    noun: 'Milestone',
    pluralNoun: 'Milestones',
    vocabularyKey: null,
    icon: Flag,
    draggable: false,
    selectable: true,
    metaKeys: ['projectId'],
  },
  actor: {
    kind: 'actor',
    noun: 'Person',
    pluralNoun: 'People',
    vocabularyKey: null,
    icon: User,
    draggable: false,
    selectable: true,
    metaKeys: [],
  },
  label: {
    kind: 'label',
    noun: 'Label',
    pluralNoun: 'Labels',
    vocabularyKey: null,
    icon: Tag,
    draggable: false,
    selectable: true,
    metaKeys: [],
  },
  calendar_slot: {
    kind: 'calendar_slot',
    noun: 'Calendar slot',
    pluralNoun: 'Calendar slots',
    vocabularyKey: null,
    icon: Schedule,
    draggable: false,
    selectable: false,
    metaKeys: ['startsAt', 'endsAt', 'laneId'],
  },
};

/** Every {@link ObjectKind}, in a stable order suitable for iteration and tests. */
export const OBJECT_KINDS = Object.keys(OBJECT_DESCRIPTORS) as readonly ObjectKind[];

/**
 * Narrow an unknown value to an {@link ObjectKind}.
 *
 * @param value - Any value, typically read off a DOM dataset or a parsed drag payload.
 * @returns `true` when the value names a described kind.
 */
export function isObjectKind(value: unknown): value is ObjectKind {
  return typeof value === 'string' && Object.hasOwn(OBJECT_DESCRIPTORS, value);
}

/**
 * Look up the descriptor for a kind.
 *
 * @param kind - The kind to describe.
 * @returns Its {@link ObjectDescriptor}.
 *
 * @example
 * ```tsx
 * const { icon: Icon } = describeObject(object.kind);
 * <Icon className="size-4" />
 * ```
 */
export function describeObject(kind: ObjectKind): ObjectDescriptor {
  return OBJECT_DESCRIPTORS[kind];
}

/**
 * The single key derivation for an object — its selection key and its React key.
 *
 * @remarks
 * Two ids from different kinds can collide (nothing guarantees a task id never equals a project
 * id), so the kind is part of the key. Every surface must use this rather than a bare id, or a
 * mixed list will select the wrong row.
 *
 * @param object - The object, or the kind/id pair identifying it.
 * @returns A stable `kind:id` key.
 */
export function objectKey(object: Pick<ObjectRef, 'kind' | 'id'>): string {
  return `${object.kind}:${object.id}`;
}

/**
 * Parse a key produced by {@link objectKey} back into its parts.
 *
 * @param key - The key to parse.
 * @returns The kind and id, or `null` when the key is malformed or names an unknown kind.
 */
export function parseObjectKey(key: string): { kind: ObjectKind; id: string } | null {
  const separator = key.indexOf(':');
  if (separator <= 0) return null;
  const kind = key.slice(0, separator);
  const id = key.slice(separator + 1);
  if (!isObjectKind(kind) || id === '') return null;
  return { kind, id };
}

/**
 * Whether two references point at the same object.
 *
 * @param a - One reference.
 * @param b - The other.
 * @returns `true` when kind and id both match.
 */
export function isSameObject(
  a: Pick<ObjectRef, 'kind' | 'id'>,
  b: Pick<ObjectRef, 'kind' | 'id'>,
): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/**
 * Read a string from an object's {@link ObjectMeta}.
 *
 * @param object - The object carrying the meta.
 * @param key - The meta key to read.
 * @returns The string value, or `null` when absent or not a string.
 */
export function objectMetaString(object: ObjectRef, key: string): string | null {
  const value = object.meta?.[key];
  return typeof value === 'string' ? value : null;
}

/**
 * The path segment each kind's detail page lives under, or `null` for kinds that have no page.
 *
 * @remarks
 * A calendar event and a time block are addressed by *when* they are, not by an id in a URL, so
 * there is nothing to link to. Typed as a total map so adding a kind forces an answer here rather
 * than silently inheriting one.
 */
const OBJECT_ROUTE_SEGMENTS: Readonly<Record<ObjectKind, string | null>> = {
  task: 'tasks',
  project: 'projects',
  initiative: 'initiatives',
  initiative_root: null,
  program: 'programs',
  cycle: 'cycles',
  team: 'teams',
  calendar_event: null,
  time_block: null,
  milestone: null,
  actor: null,
  label: null,
  calendar_slot: null,
};

/**
 * The canonical in-app path for one object.
 *
 * @remarks
 * The single derivation of "where does this thing live". Before this existed the same template
 * literal was retyped in every action module and every row, which is how a kind ends up linked one
 * way from a menu and another way from a list. Anything that needs to *name* an object's location —
 * a menu's Open, a copied link, a drag's URL flavor — comes through here.
 *
 * @param object - The object to locate.
 * @returns Its app-relative path, or `null` when the object has no detail page or no workspace.
 *
 * @example
 * ```ts
 * const href = objectHref(task); // '/orgs/01JX…/tasks/01JY…'
 * ```
 */
export function objectHref(object: ObjectRef): string | null {
  const segment = OBJECT_ROUTE_SEGMENTS[object.kind];
  if (segment === null || object.organizationId === null) return null;
  return `/orgs/${object.organizationId}/${segment}/${object.id}`;
}

/** The DOM attributes that mark an element as *being* a core object. */
export interface ObjectTargetProps {
  /** The object's kind, read by the global context-menu handler. */
  readonly 'data-object-kind': ObjectKind;
  /** The object's id. */
  readonly 'data-object-id': string;
  /** The object's workspace, omitted entirely when it is personal/unscoped. */
  readonly 'data-object-org'?: string;
  /** The object's title, so a menu can name it without re-fetching. */
  readonly 'data-object-title': string;
  /** JSON-encoded {@link ObjectMeta}, omitted when the object carries none. */
  readonly 'data-object-meta'?: string;
}

/**
 * Mark a DOM element as one core object.
 *
 * @remarks
 * This is the whole bridge between React surfaces and the app's single document-level right-click
 * handler: the handler never imports a surface, it walks up from the event target until it finds
 * an element wearing these attributes. Spread the result on the outermost element that represents
 * the object — a list row, a calendar block, a detail-page header.
 *
 * @param object - The object this element represents.
 * @returns Attributes to spread onto the element.
 *
 * @example
 * ```tsx
 * <ListRow {...objectTargetProps(task)} {...dragProps} />
 * ```
 *
 * @see {@link readObjectTarget} for the inverse.
 */
export function objectTargetProps(object: ObjectRef): ObjectTargetProps {
  return {
    'data-object-kind': object.kind,
    'data-object-id': object.id,
    ...(object.organizationId === null ? {} : { 'data-object-org': object.organizationId }),
    'data-object-title': object.title,
    ...(object.meta === undefined ? {} : { 'data-object-meta': JSON.stringify(object.meta) }),
  };
}

/** The CSS selector matching any element marked by {@link objectTargetProps}. */
export const OBJECT_TARGET_SELECTOR = '[data-object-kind][data-object-id]';

/**
 * Recover the {@link ObjectRef} an element represents.
 *
 * @remarks
 * Returns `null` rather than throwing for anything malformed, because the only caller is a global
 * event handler that must never break the page over a stray attribute.
 *
 * @param element - The element to read, typically `event.target.closest(OBJECT_TARGET_SELECTOR)`.
 * @returns The object, or `null` when the element does not carry a complete marking.
 */
export function readObjectTarget(element: Element | null): ObjectRef | null {
  if (element === null || !(element instanceof HTMLElement)) return null;
  const kind = element.dataset['objectKind'];
  const id = element.dataset['objectId'];
  const title = element.dataset['objectTitle'];
  if (!isObjectKind(kind) || id === undefined || id === '' || title === undefined) return null;
  const organizationId = element.dataset['objectOrg'] ?? null;
  const meta = parseObjectMeta(element.dataset['objectMeta']);
  return {
    kind,
    id,
    organizationId,
    title,
    ...(meta === null ? {} : { meta }),
  };
}

/** Parse the serialized meta attribute, tolerating absence and corruption alike. */
function parseObjectMeta(raw: string | undefined): ObjectMeta | null {
  if (raw === undefined || raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed).filter(
      ([, value]) =>
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean',
    );
    return Object.fromEntries(entries);
  } catch {
    return null;
  }
}
