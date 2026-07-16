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
  /** Continuous scheduling-canvas preferences and quick-create defaults. */
  readonly calendar?: {
    /** Continuous vertical zoom in pixels per hour. */
    readonly pixelsPerHour?: number;
    /** Minimum date-lane width in pixels before horizontal scrolling. */
    readonly minLaneWidth?: number;
    /** Whether new selected regions default to events or timeboxes. */
    readonly defaultCreateIntent?: 'event' | 'timebox';
    /** Preferred native or writable provider layer for event creation. */
    readonly defaultLayerId?: string | null;
  };
  /** Persistent instructions and approval policy for the user-owned Athena assistant. */
  readonly athena?: {
    /** Personal guidance Athena follows across every workspace. */
    readonly instructions?: string;
    /** How much autonomy Athena has for state-changing work. */
    readonly approvalMode?: 'ask_before_acting' | 'routine_autonomy' | 'suggest_only';
  };
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

/** Delivery channels supported by the notification service. */
export type NotificationServiceChannel = 'web' | 'email' | 'sms' | 'push';
/** Notification-service categories that drive policy and preferences. */
export type NotificationServiceCategory =
  | 'security'
  | 'account'
  | 'service_announcement'
  | 'workflow'
  | 'digest'
  | 'billing'
  | 'marketing';
/** Why a recipient was included in a notification intent. */
export type NotificationRecipientReason =
  | 'explicit'
  | 'org_member'
  | 'segment_match'
  | 'owner'
  | 'assignee';
/** Why a delivery was suppressed or delayed. */
export type NotificationSuppressionReason =
  | 'user_disabled_channel'
  | 'quiet_hours'
  | 'no_verified_contact_point'
  | 'contact_point_bounced'
  | 'user_unsubscribed'
  | 'category_disallows_channel'
  | 'staff_approval_missing'
  | 'duplicate_idempotency_key'
  | 'legal_suppression';

/** Audience selector persisted on a notification intent. */
export type NotificationAudience =
  | { readonly type: 'user'; readonly userId: string }
  | { readonly type: 'users'; readonly userIds: readonly string[] }
  | { readonly type: 'organization'; readonly organizationId: string }
  | { readonly type: 'all_users' }
  | {
      readonly type: 'segment';
      readonly segment:
        | 'active_users'
        | 'trial_users'
        | 'billing_admins'
        | 'users_with_bounced_email'
        | 'users_without_verified_phone';
    };

/** Text/html content persisted on a notification intent. */
export interface NotificationContent {
  /** Plain text content for email/SMS/push fallbacks. */
  readonly text?: string;
  /** HTML content for email-capable destinations. */
  readonly html?: string;
  /** Additional channel-specific rendering metadata. */
  readonly [key: string]: unknown;
}

/** Quiet-hours preference window. */
export interface NotificationQuietHours {
  /** Whether the quiet-hours window is active. */
  readonly enabled: boolean;
  /** Local start time in HH:MM. */
  readonly start: string;
  /** Local end time in HH:MM. */
  readonly end: string;
  /** Days where the quiet-hours window applies. */
  readonly days: readonly ('mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun')[];
  /** Whether urgent notifications can bypass quiet hours. */
  readonly allowUrgent?: boolean;
}

/** Channel preferences for one notification category. */
export interface NotificationChannelPreference {
  readonly web?: boolean;
  readonly email?: boolean;
  readonly sms?: boolean;
  readonly push?: boolean;
  readonly locked?: boolean;
}

/** Preference map keyed by notification category. */
export type NotificationCategoryPreferences = Record<string, NotificationChannelPreference>;
/** Per-organization preference map keyed by organization id, then category. */
export type NotificationOrganizationPreferences = Record<string, NotificationCategoryPreferences>;

/** One suppression attached to a recipient or delivery decision. */
export interface NotificationSuppression {
  /** Suppression reason. */
  readonly reason: NotificationSuppressionReason;
  /** Channel affected by the suppression, when channel-specific. */
  readonly channel?: NotificationServiceChannel;
  /** Human-readable operational detail. */
  readonly detail?: string;
}

/** Channel destination metadata. */
export interface NotificationDestination {
  /** Masked destination shown in operational views. */
  readonly valueMasked?: string;
  /** Contact point used for the delivery, when applicable. */
  readonly contactPointId?: string;
  /** Additional destination metadata. */
  readonly [key: string]: unknown;
}

/** Secret-free provider payload metadata retained for audit/debugging. */
export type NotificationProviderPayload = Record<string, unknown>;

// The canonical event jsonb shapes (`event.actor`/`event.entity`/`event.detail`,
// `daily_digest.stats`) are owned by `@docket/types` — the `event` substrate's contract.
// We re-export them as the schema's `$type` shapes rather than re-mirroring, so the column
// type and the DTO can never drift (the failure mode HubPreferences hit).
export type { ActorRef, EntityRef, EventDetail, DigestStats } from '@docket/types';

// The layered-calendar jsonb shapes (`calendar_connection.scope_state`,
// `calendar_item.permissions`, `calendar_item.conflict`) are likewise owned by
// `@docket/types` and re-exported rather than mirrored.
export type {
  CalendarScopeState,
  CalendarItemPermission,
  CalendarItemConflict,
  CalendarItemWritePatch,
} from '@docket/types';

// The durable transcript message shape is likewise owned by `@docket/types` — the
// agent-turn boundary port speaks it and `agent_session_transcript.messages` persists
// it, so the resumed conversation can never drift from what the runtime emitted.
export type { TurnContentBlock, TurnMessage } from '@docket/types';

/** A session Activity payload; `action` rows carry the proposed change. */
export interface SessionActivityBody {
  /** Free text (thought/response/elicitation/error). */
  readonly text?: string;
  /** The caller-validated focus attached to a user-authored personal Athena message. */
  readonly context?: {
    /** Workspace focus; context never grants authority. */
    readonly workspaceId?: string;
    /** Optional canonical source object that opened Athena. */
    readonly source?: {
      /** Supported ambient entry-point kind. */
      readonly type:
        | 'task'
        | 'project'
        | 'initiative'
        | 'program'
        | 'calendar_item'
        | 'stream_event';
      /** Canonical source row id. */
      readonly id: string;
    };
  };
  /** Application attribution for human-authored response rows. */
  readonly author?: 'user' | 'athena';
  /** For `action` activities: the proposed change + its approval linkage. */
  readonly action?: {
    /** Action kind (e.g. `update_task`). */
    readonly kind: string;
    /** Human-readable summary of the proposed change. */
    readonly summary: string;
    /** Optional structured diff. */
    readonly diff?: unknown;
    /**
     * The persisted, executable tool call behind a gated action.
     *
     * @remarks
     * What approval executes: the toolbox connection (`docket` or a remote alias),
     * the raw tool name, its input, and the provider `tool_use` id so the result can
     * be paired back into the transcript. Absent on legacy narration-only actions.
     */
    readonly toolCall?: {
      /** Toolbox connection key (`docket`, or a remote integration alias). */
      readonly connection: string;
      /** The raw (un-namespaced) tool name on that connection. */
      readonly tool: string;
      /** The tool input as proposed (editable until approved). */
      readonly input: unknown;
      /** The provider `tool_use` block id this call answers. */
      readonly toolUseId: string;
    };
    /** The execution result once applied (also fed back as the `tool_result`). */
    readonly result?: {
      /** Serialized result content. */
      readonly content: string;
      /** Whether execution failed. */
      readonly isError: boolean;
    };
    /**
     * How the gate treated this action: a `proposal` executes on approval; a
     * `suggestion` (suggest-only policy) is recorded and never executes.
     */
    readonly mode?: 'proposal' | 'suggestion';
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
