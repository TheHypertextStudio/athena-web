/**
 * `@docket/db` — TypeScript shapes for every `jsonb` column (`.$type<>()`).
 *
 * @remarks
 * These are the db-internal `$type` shapes + their default constants. The canonical
 * Zod source of truth for the cross-app shapes (VocabularySkin, HubPreferences,
 * view config) lives in `@docket/types`; these mirror them so the schema is
 * self-contained and drizzle can attach a typed default.
 */

/** The five workflow-state types a per-team state key maps onto. */
export type WorkflowStateType = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';

/** One configurable workflow state in a team's `workflow_states` array. */
export interface WorkflowState {
  /** Stable key stored on `task.state`. */
  readonly key: string;
  /** Display name. */
  readonly name: string;
  /** The canonical type (drives status icons + grouping). */
  readonly type: WorkflowStateType;
  /** Order within the team's state list. */
  readonly position: number;
}

/** Default per-team workflow; the first state's key (`backlog`) is the new-task default. */
export const defaultWorkflowStates: readonly WorkflowState[] = [
  { key: 'backlog', name: 'Backlog', type: 'backlog', position: 0 },
  { key: 'todo', name: 'Todo', type: 'unstarted', position: 1 },
  { key: 'in_progress', name: 'In Progress', type: 'started', position: 2 },
  { key: 'done', name: 'Done', type: 'completed', position: 3 },
  { key: 'canceled', name: 'Canceled', type: 'canceled', position: 4 },
];

/** The vocabulary preset bundles selectable per org. */
export type VocabularyPreset = 'startup' | 'nonprofit' | 'agency';

/** A singular/plural label pair for one vocabulary key. */
export interface VocabularyTerm {
  /** Singular form (e.g. "Project"). */
  readonly singular: string;
  /** Plural form (e.g. "Projects"). */
  readonly plural: string;
}

/** An org's vocabulary skin: a preset plus optional per-key overrides. */
export interface VocabularySkin {
  /** The base preset. */
  readonly preset: VocabularyPreset;
  /** Per-key overrides (key ∈ initiative/program/project/task/cycle/team). */
  readonly overrides?: Record<string, VocabularyTerm>;
}

/** The default vocabulary skin for new organizations. */
export const presetStartup: VocabularySkin = { preset: 'startup' };

/** Where the Hub lands on open: the Hub, the last-used context, or a specific org. */
export type HubLanding = 'hub' | 'last' | { readonly orgId: string };

/** Personal Hub preferences. */
export interface HubPreferences {
  /** Landing surface on open. */
  readonly landing?: HubLanding;
  /** Row density. */
  readonly density?: 'comfortable' | 'compact';
  /** Theme preference. */
  readonly theme?: 'system' | 'light' | 'dark';
  /** IANA timezone for the daily plan (also the digest's day boundary + send time). */
  readonly timezone?: string;
  /** Daily digest delivery settings (the Sunsama-style end-of-day summary). */
  readonly digest?: {
    /** Whether the daily digest is generated and delivered. */
    readonly enabled?: boolean;
    /** Local clock time to send, `"HH:MM"` 24-hour (interpreted in `timezone`). */
    readonly sendAtLocalTime?: string;
    /** Where to deliver the digest. */
    readonly channels?: readonly ('email' | 'inApp')[];
  };
  /** Proactive-agent settings — whether incoming mentions/assignments auto-draft a plan. */
  readonly proactive?: {
    /** When true, a mention/assignment observation spawns an (approval-gated) agent plan. */
    readonly enabled?: boolean;
  };
}

/** The wire protocol an agent's runtime speaks. */
export type AgentProtocol = 'mcp' | 'a2a' | 'webhook';

/** How Docket reaches an agent's external runtime. */
export interface AgentConnection {
  /** Runtime endpoint URL. */
  readonly endpoint: string;
  /** Protocol Docket uses to talk to it. */
  readonly protocol: AgentProtocol;
  /** Reference to the stored credential (never the secret itself). */
  readonly credentialsRef?: string;
}

/** Who approves an agent's gated actions. */
export interface ApprovalRouting {
  /** Routing mode: the assigner, a fixed actor, or a role. */
  readonly mode: 'assigner' | 'fixed' | 'role';
  /** Approver actor (when mode = fixed). */
  readonly approverActorId?: string;
  /** Approver role (when mode = role). */
  readonly approverRoleId?: string;
}

/** An external integration's connection metadata. */
export interface IntegrationConnection {
  /** External account/login label. */
  readonly account?: string;
  /** Reference to the stored OAuth credential. */
  readonly credentialsRef?: string;
  /** External workspace identifier (for scoping imports + webhook routing, e.g. Linear's org id). */
  readonly externalWorkspaceId?: string;
  /** External workspace slug/url-key (e.g. Linear's `urlKey`), persisted alongside the id. */
  readonly externalWorkspaceSlug?: string;
}

/** Organizer details cached from a Google Calendar event. */
export interface CalendarEventOrganizer {
  /** Organizer email, when provided by Google. */
  readonly email?: string | null;
  /** Organizer display name, when provided by Google. */
  readonly displayName?: string | null;
  /** Whether the organizer is the linked Google account. */
  readonly self?: boolean;
}

/** Attendee details cached from a Google Calendar event. */
export interface CalendarEventAttendee {
  /** Attendee email, when provided by Google. */
  readonly email?: string | null;
  /** Attendee display name, when provided by Google. */
  readonly displayName?: string | null;
  /** Provider response status, such as accepted/declined/needsAction. */
  readonly responseStatus?: string | null;
  /** Whether the attendee is optional. */
  readonly optional?: boolean;
  /** Whether the attendee is the linked Google account. */
  readonly self?: boolean;
}

/** Notification payload; `title` is required, the rest is type-specific. */
export interface NotificationBody {
  /** Headline shown in the inbox. */
  readonly title: string;
  /** Optional supporting summary. */
  readonly summary?: string;
  /** Optional deep link. */
  readonly url?: string;
  /** Additional type-specific fields. */
  readonly [key: string]: unknown;
}

// The canonical event jsonb shapes (`event.actor`/`event.entity`/`event.detail`,
// `daily_digest.stats`) are owned by `@docket/types` — the `event` substrate's contract.
// We re-export them as the schema's `$type` shapes rather than re-mirroring, so the column
// type and the DTO can never drift (the failure mode HubPreferences hit).
export type { ActorRef, EntityRef, EventDetail, DigestStats } from '@docket/types';

/** A session Activity payload; `action` rows carry the proposed change. */
export interface SessionActivityBody {
  /** Free text (thought/response/elicitation/error). */
  readonly text?: string;
  /** For `action` activities: the proposed change + its approval linkage. */
  readonly action?: {
    /** Action kind (e.g. `update_task`). */
    readonly kind: string;
    /** Human-readable summary of the proposed change. */
    readonly summary: string;
    /** Optional structured diff. */
    readonly diff?: unknown;
  };
  /** Additional fields. */
  readonly [key: string]: unknown;
}

/** One predicate in a saved view's filter set. */
export interface ViewFilter {
  /** Field to filter on. */
  readonly field: string;
  /** Comparison operator. */
  readonly op: 'eq' | 'neq' | 'in' | 'nin' | 'gt' | 'lt' | 'contains';
  /** Comparison value. */
  readonly value: unknown;
}

/** A saved view's grouping config (group + optional sub-group). */
export interface ViewGrouping {
  /** Primary group-by field. */
  readonly by: string;
  /** Optional secondary group-by field. */
  readonly subBy?: string;
}

/** One sort term in a saved view. */
export interface ViewSort {
  /** Field to sort by. */
  readonly field: string;
  /** Sort direction. */
  readonly order: 'asc' | 'desc';
}

/** A single capability literal. */
export type GrantCapability = 'view' | 'comment' | 'contribute' | 'assign' | 'manage';
/** A list of capability literals (a grant's `capabilities` column). */
export type GrantCapabilityList = readonly GrantCapability[];
