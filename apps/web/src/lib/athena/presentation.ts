/**
 * Pure presentation contracts for the user-owned Athena experience.
 *
 * @remarks
 * These intentionally sit between the personal API and React. The personal API lane can replace
 * the structural transport types without changing the rail, job card, or work-ledger components.
 */
import type { McpAppPresentation } from '@docket/integrations/mcp-apps-contract';

import { describeToolActivity } from './describe-proposal';

/** The Docket-native service name, which never prefixes its own work-log rows. */
const DOCKET_SERVICE_NAME = 'Docket';

/** A Docket object Athena was opened from. */
export interface PersonalAthenaSource {
  readonly type: 'task' | 'project' | 'initiative' | 'program' | 'calendar_item' | 'stream_event';
  readonly id: string;
  readonly label?: string;
}

/** The optional workspace and object focus carried into personal Athena work. */
export interface PersonalAthenaContext {
  readonly workspaceId?: string | undefined;
  readonly workspaceName?: string | undefined;
  readonly source?: PersonalAthenaSource | undefined;
}

/** Stable lifecycle states exposed by the personal Athena API. */
export type PersonalAthenaStatus =
  | 'pending'
  | 'running'
  | 'awaiting_input'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'canceled';

/** The three user-facing queue lanes. */
export type AthenaQueueState = 'needs_you' | 'working' | 'finished';

/** A compact personal work row returned by `/v1/me/athena`. */
export interface PersonalAthenaSessionSummary {
  readonly id: string;
  readonly objective: string;
  readonly status: PersonalAthenaStatus;
  readonly queueState?: AthenaQueueState;
  readonly workspace?: { readonly id: string; readonly name: string } | null;
  readonly context?: PersonalAthenaContext | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A choice Athena is waiting for the owner to make. */
export interface PersonalAthenaDecision {
  readonly kind: 'approval' | 'question';
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly private?: boolean;
  readonly options: readonly { readonly id: string; readonly label: string }[];
}

/** One API activity beat. Reasoning is accepted only so the presenter can explicitly discard it. */
export type PersonalAthenaActivity =
  | {
      readonly id: string;
      readonly type: 'reasoning';
      readonly createdAt: string;
      readonly text: string;
    }
  | {
      readonly id: string;
      readonly type: 'progress' | 'message' | 'question' | 'error';
      readonly createdAt: string;
      readonly text: string;
      readonly author?: 'user' | 'athena';
    }
  | {
      readonly id: string;
      readonly type: 'tool';
      readonly createdAt: string;
      readonly service: string;
      readonly action: string;
      readonly outcome?: string;
      readonly presentation?: McpAppPresentation;
      readonly presentationUnavailable?: boolean;
      readonly technical?: {
        readonly toolName?: string;
        readonly input?: unknown;
        readonly output?: unknown;
      };
    };

/** The selected personal work item returned by `/v1/me/athena/sessions/:id`. */
export interface PersonalAthenaSessionDetail extends PersonalAthenaSessionSummary {
  readonly decision?: PersonalAthenaDecision | null | undefined;
  readonly activities: readonly PersonalAthenaActivity[];
  readonly activityNextCursor?: string | undefined;
  readonly result?:
    | {
        readonly title: string;
        readonly summary: string;
        readonly receipt?: readonly { readonly label: string; readonly value: string }[];
      }
    | null
    | undefined;
}

/** A single user-facing work-log row. */
export interface AthenaActivityPresentation {
  readonly id: string;
  readonly kind: Exclude<PersonalAthenaActivity['type'], 'reasoning'>;
  readonly title: string;
  readonly detail?: string;
  readonly createdAt: string;
  readonly presentation?: McpAppPresentation;
  readonly presentationUnavailable?: boolean;
  readonly technical?: {
    readonly toolName?: string;
    readonly input?: unknown;
    readonly output?: unknown;
  };
}

/** Map a lifecycle state to its queue lane. */
export function athenaQueueState(status: PersonalAthenaStatus): AthenaQueueState {
  if (status === 'awaiting_input' || status === 'awaiting_approval') return 'needs_you';
  if (status === 'completed' || status === 'failed' || status === 'canceled') return 'finished';
  return 'working';
}

/**
 * The row's detail for a tool activity: the outcome, prefixed with the service name when that
 * service is worth naming.
 *
 * @remarks
 * "Docket · Set state to In Progress" tells a person nothing "Set state to In Progress" doesn't;
 * "Gmail · Sent 3 emails" does. With no outcome there is nothing to prefix, so the service alone
 * never stands in as a detail.
 */
function toolActivityDetail(
  activity: Extract<PersonalAthenaActivity, { type: 'tool' }>,
): string | undefined {
  if (!activity.outcome) return undefined;
  return activity.service === DOCKET_SERVICE_NAME
    ? activity.outcome
    : `${activity.service} · ${activity.outcome}`;
}

/** Convert one API tool activity to plain-language work-log presentation. */
function presentAthenaToolActivity(
  activity: Extract<PersonalAthenaActivity, { type: 'tool' }>,
): AthenaActivityPresentation {
  const detail = toolActivityDetail(activity);
  return {
    id: activity.id,
    kind: 'tool',
    title: describeToolActivity(activity),
    ...(detail ? { detail } : {}),
    createdAt: activity.createdAt,
    ...(activity.presentation ? { presentation: activity.presentation } : {}),
    ...(activity.presentationUnavailable ? { presentationUnavailable: true } : {}),
    ...(activity.technical ? { technical: activity.technical } : {}),
  };
}

/** Convert one API activity to plain-language work-log presentation, discarding raw reasoning. */
export function presentAthenaActivity(
  activity: PersonalAthenaActivity,
): AthenaActivityPresentation | null {
  if (activity.type === 'reasoning') return null;
  if (activity.type === 'tool') return presentAthenaToolActivity(activity);
  return {
    id: activity.id,
    kind: activity.type,
    title:
      activity.type === 'message' && activity.author === 'user'
        ? 'You asked'
        : activity.type === 'question'
          ? 'Athena asked'
          : activity.type === 'error'
            ? 'Athena stopped'
            : 'Progress',
    detail: activity.text,
    createdAt: activity.createdAt,
  };
}
