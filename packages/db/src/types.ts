/**
 * `@docket/db` — TypeScript shapes for every `jsonb` column (`.$type<>()`).
 *
 * @remarks
 * These are the db-internal `$type` shapes + their default constants. The canonical
 * Zod source of truth for the cross-app shapes (VocabularySkin, HubPreferences,
 * view config) lives in `@docket/types`; these mirror them so the schema is
 * self-contained and drizzle can attach a typed default.
 */
import {
  DEFAULT_WORKFLOW_STATES,
  type WorkflowState as WorkflowStateShape,
  type WorkStatusCategory,
} from '@docket/types';
import type { Capability } from '@docket/identity-access/capabilities';
import type { VocabularyPreset, VocabularySkin, VocabularyTerm } from '@docket/work/vocabulary';

export type { WorkStatusCategory };

/**
 * The five workflow-state types a state key maps onto.
 *
 * @remarks
 * Re-exported from `@docket/types`, which is the one declaration. The copy that used to live
 * here drifted from it by construction; this alias cannot.
 */
export type WorkflowStateType = WorkStatusCategory;

/**
 * One configurable workflow state in a team's `workflow_states` array.
 *
 * @remarks
 * Re-exported from `@docket/types` so the drizzle `.$type<>()` annotation and the Zod schema
 * describe the same shape.
 */
export type WorkflowState = WorkflowStateShape;

/** Default per-team workflow; the first state's key (`backlog`) is the new-task default. */
export const defaultWorkflowStates: readonly WorkflowState[] = DEFAULT_WORKFLOW_STATES;

/** Work owns the vocabulary grammar the database persists. */
export type { VocabularyPreset, VocabularySkin, VocabularyTerm };
/** Legacy database export for Work's compact default organization skin. */
export { defaultVocabularySkin as presetStartup } from '@docket/work/vocabulary';

/** Where the Hub lands on open: the Hub, the last-used context, or a specific org. */
export type HubLanding = 'hub' | 'last' | { readonly orgId: string };

/** Personal Hub preferences. */
export interface HubPreferences {
  /** Landing surface on open. */
  readonly landing?: HubLanding | undefined;
  /** Row density. */
  readonly density?: 'comfortable' | 'compact' | undefined;
  /** Theme preference. */
  readonly theme?: 'system' | 'light' | 'dark' | undefined;
  /** IANA timezone for the daily plan (also the digest's day boundary + send time). */
  readonly timezone?: string | undefined;
  /** Continuous scheduling-canvas preferences and quick-create defaults. */
  readonly calendar?:
    | {
        /** Continuous vertical zoom in pixels per hour. */
        readonly pixelsPerHour?: number | undefined;
        /** Minimum date-lane width in pixels before horizontal scrolling. */
        readonly minLaneWidth?: number | undefined;
        /** Whether new selected regions default to events or timeboxes. */
        readonly defaultCreateIntent?: 'event' | 'timebox' | undefined;
        /** Preferred native or writable provider layer for event creation. */
        readonly defaultLayerId?: string | null | undefined;
      }
    | undefined;
  /** Persistent instructions and approval policy for the user-owned Athena assistant. */
  readonly athena?:
    | {
        /** Personal guidance Athena follows across every workspace. */
        readonly instructions?: string | undefined;
        /** How much autonomy Athena has for state-changing work. */
        readonly approvalMode?:
          | 'ask_before_acting'
          | 'routine_autonomy'
          | 'suggest_only'
          | undefined;
      }
    | undefined;
  /** Daily digest delivery settings (the Sunsama-style end-of-day summary). */
  readonly digest?:
    | {
        /** Whether the daily digest is generated and delivered. */
        readonly enabled?: boolean | undefined;
        /** Local clock time to send, `"HH:MM"` 24-hour (interpreted in `timezone`). */
        readonly sendAtLocalTime?: string | undefined;
        /** Where to deliver the digest. */
        readonly channels?: readonly ('email' | 'inApp')[] | undefined;
      }
    | undefined;
  /** Proactive-agent settings — whether incoming mentions/assignments auto-draft a plan. */
  readonly proactive?:
    | {
        /** When true, a mention/assignment observation spawns an (approval-gated) agent plan. */
        readonly enabled?: boolean | undefined;
      }
    | undefined;
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
  readonly credentialsRef?: string | undefined;
}

/** Who approves an agent's gated actions. */
export interface ApprovalRouting {
  /** Routing mode: the assigner, a fixed actor, or a role. */
  readonly mode: 'assigner' | 'fixed' | 'role';
  /** Approver actor (when mode = fixed). */
  readonly approverActorId?: string | undefined;
  /** Approver role (when mode = role). */
  readonly approverRoleId?: string | undefined;
}

/** An external integration's connection metadata. */
export interface IntegrationConnection {
  /** External account/login label. */
  readonly account?: string | undefined;
  /** Reference to the stored OAuth credential. */
  readonly credentialsRef?: string | undefined;
  /** External workspace identifier (for scoping imports + webhook routing, e.g. Linear's org id). */
  readonly externalWorkspaceId?: string | undefined;
  /** External workspace slug/url-key (e.g. Linear's `urlKey`), persisted alongside the id. */
  readonly externalWorkspaceSlug?: string | undefined;
}

/** Organizer details cached from a Google Calendar event. */
export interface CalendarEventOrganizer {
  /** Organizer email, when provided by Google. */
  readonly email?: string | null | undefined;
  /** Organizer display name, when provided by Google. */
  readonly displayName?: string | null | undefined;
  /** Whether the organizer is the linked Google account. */
  readonly self?: boolean | undefined;
}

/** Attendee details cached from a Google Calendar event. */
export interface CalendarEventAttendee {
  /** Attendee email, when provided by Google. */
  readonly email?: string | null | undefined;
  /** Attendee display name, when provided by Google. */
  readonly displayName?: string | null | undefined;
  /** Provider response status, such as accepted/declined/needsAction. */
  readonly responseStatus?: string | null | undefined;
  /** Whether the attendee is optional. */
  readonly optional?: boolean | undefined;
  /** Whether the attendee is the linked Google account. */
  readonly self?: boolean | undefined;
}

/** Notification payload; `title` is required, the rest is type-specific. */
export interface NotificationBody {
  /** Headline shown in the inbox. */
  readonly title: string;
  /** Optional supporting summary. */
  readonly summary?: string | undefined;
  /** Optional deep link. */
  readonly url?: string | undefined;
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
  readonly text?: string | undefined;
  /** HTML content for email-capable destinations. */
  readonly html?: string | undefined;
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
  readonly allowUrgent?: boolean | undefined;
}

/** Channel preferences for one notification category. */
export interface NotificationChannelPreference {
  readonly web?: boolean | undefined;
  readonly email?: boolean | undefined;
  readonly sms?: boolean | undefined;
  readonly push?: boolean | undefined;
  readonly locked?: boolean | undefined;
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
  readonly channel?: NotificationServiceChannel | undefined;
  /** Human-readable operational detail. */
  readonly detail?: string | undefined;
}

/** Channel destination metadata. */
export interface NotificationDestination {
  /** Masked destination shown in operational views. */
  readonly valueMasked?: string | undefined;
  /** Contact point used for the delivery, when applicable. */
  readonly contactPointId?: string | undefined;
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
  readonly text?: string | undefined;
  /** The caller-validated focus attached to a user-authored personal Athena message. */
  readonly context?:
    | {
        /** Workspace focus; context never grants authority. */
        readonly workspaceId?: string | undefined;
        /** Optional canonical source object that opened Athena. */
        readonly source?:
          | {
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
            }
          | undefined;
      }
    | undefined;
  /** Application attribution for human-authored response rows. */
  readonly author?: 'user' | 'athena' | undefined;
  /**
   * Where a `author: 'user'` row's text actually came from.
   *
   * @remarks
   * `author` answers "was this the agent or not", which is the question the timeline renders.
   * It cannot answer "was this the account owner or a stranger who emailed them", and those need
   * different treatment: the model must weigh the second as third-party material rather than
   * direction. Absent means `principal` — every row written before this field existed came from
   * an authenticated Docket surface.
   *
   * The text stored here stays raw so a person reads what was actually sent; the enveloping
   * happens on the transcript the model reads. See `agent/provenance.ts`.
   */
  readonly provenance?: 'principal' | 'email' | 'linear' | undefined;
  /** Display identity of a non-principal author, e.g. the sending email address. */
  readonly origin?: string | undefined;
  /** For `action` activities: the proposed change + its approval linkage. */
  readonly action?:
    | {
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
        readonly toolCall?:
          | {
              /** Toolbox connection key (`docket`, or a remote integration alias). */
              readonly connection: string;
              /** The raw (un-namespaced) tool name on that connection. */
              readonly tool: string;
              /** The tool input as proposed (editable until approved). */
              readonly input: unknown;
              /** The provider `tool_use` block id this call answers. */
              readonly toolUseId: string;
            }
          | undefined;
        /** The execution result once applied (also fed back as the `tool_result`). */
        readonly result?:
          | {
              /** Serialized result content. */
              readonly content: string;
              /** Whether execution failed. */
              readonly isError: boolean;
            }
          | undefined;
        /**
         * How the gate treated this action: a `proposal` executes on approval; a
         * `suggestion` (suggest-only policy) is recorded and never executes.
         */
        readonly mode?: 'proposal' | 'suggestion' | undefined;
      }
    | undefined;
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
  readonly subBy?: string | undefined;
}

/** One sort term in a saved view. */
export interface ViewSort {
  /** Field to sort by. */
  readonly field: string;
  /** Sort direction. */
  readonly order: 'asc' | 'desc';
}

/** A single capability literal. */
export type GrantCapability = Capability;
/** A list of capability literals (a grant's `capabilities` column). */
export type GrantCapabilityList = readonly GrantCapability[];
