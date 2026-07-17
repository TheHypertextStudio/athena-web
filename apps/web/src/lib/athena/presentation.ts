/**
 * Pure presentation contracts for the user-owned Athena experience.
 *
 * @remarks
 * These intentionally sit between the personal API and React. The personal API lane can replace
 * the structural transport types without changing the queue, dock, or workbench components.
 */

/** A Docket object Athena was opened from. */
export interface PersonalAthenaSource {
  readonly type: 'task' | 'project' | 'initiative' | 'program' | 'calendar_item' | 'stream_event';
  readonly id: string;
  readonly label?: string;
}

/** The optional workspace and object focus carried into personal Athena work. */
export interface PersonalAthenaContext {
  readonly workspaceId?: string;
  readonly workspaceName?: string;
  readonly source?: PersonalAthenaSource;
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
      readonly technical?: {
        readonly toolName?: string;
        readonly input?: unknown;
        readonly output?: unknown;
      };
    };

/** The selected personal work item returned by `/v1/me/athena/sessions/:id`. */
export interface PersonalAthenaSessionDetail extends PersonalAthenaSessionSummary {
  readonly decision?: PersonalAthenaDecision | null;
  readonly activities: readonly PersonalAthenaActivity[];
  readonly activityNextCursor?: string;
  readonly result?: {
    readonly title: string;
    readonly summary: string;
    readonly receipt?: readonly { readonly label: string; readonly value: string }[];
  } | null;
}

/** A single user-facing work-log row. */
export interface AthenaActivityPresentation {
  readonly id: string;
  readonly kind: Exclude<PersonalAthenaActivity['type'], 'reasoning'>;
  readonly title: string;
  readonly detail?: string;
  readonly createdAt: string;
  readonly technical?: {
    readonly toolName?: string;
    readonly input?: unknown;
    readonly output?: unknown;
  };
}

/** A complete workbench view model. */
export interface AthenaSessionPresentation {
  readonly id: string;
  readonly objective: string;
  readonly stateLabel: string;
  readonly workspaceLabel: string | null;
  readonly contextLabel: string | null;
  readonly decision: PersonalAthenaDecision | null;
  readonly activity: readonly AthenaActivityPresentation[];
  readonly result: PersonalAthenaSessionDetail['result'];
  readonly canPause: boolean;
  readonly canResume: boolean;
  readonly canCancel: boolean;
  readonly commandLabel: string;
}

const LANE_LABELS: Readonly<Record<AthenaQueueState, string>> = {
  needs_you: 'Needs you',
  working: 'Working',
  finished: 'Finished',
};

const STATUS_LABELS: Readonly<Record<PersonalAthenaStatus, string>> = {
  pending: 'Queued',
  running: 'In progress',
  awaiting_input: 'Waiting for your answer',
  awaiting_approval: 'Waiting for your approval',
  completed: 'Finished',
  failed: 'Stopped with an issue',
  canceled: 'Cancelled',
};

/** Map a lifecycle state to its queue lane. */
export function athenaQueueState(status: PersonalAthenaStatus): AthenaQueueState {
  if (status === 'awaiting_input' || status === 'awaiting_approval') return 'needs_you';
  if (status === 'completed' || status === 'failed' || status === 'canceled') return 'finished';
  return 'working';
}

/** Group personal work in the fixed product order used by the dock and full workspace. */
export function groupAthenaQueue(sessions: readonly PersonalAthenaSessionSummary[]): readonly {
  readonly key: AthenaQueueState;
  readonly label: string;
  readonly items: readonly PersonalAthenaSessionSummary[];
}[] {
  const order: readonly AthenaQueueState[] = ['needs_you', 'working', 'finished'];
  return order.map((key) => ({
    key,
    label: LANE_LABELS[key],
    items: sessions.filter(
      (session) => (session.queueState ?? athenaQueueState(session.status)) === key,
    ),
  }));
}

/** Convert one API activity to plain-language work-log presentation, discarding raw reasoning. */
export function presentAthenaActivity(
  activity: PersonalAthenaActivity,
): AthenaActivityPresentation | null {
  if (activity.type === 'reasoning') return null;
  if (activity.type === 'tool') {
    return {
      id: activity.id,
      kind: 'tool',
      title: `${activity.service} · ${activity.action}`,
      ...(activity.outcome ? { detail: activity.outcome } : {}),
      createdAt: activity.createdAt,
      ...(activity.technical ? { technical: activity.technical } : {}),
    };
  }
  return {
    id: activity.id,
    kind: activity.type,
    title:
      activity.type === 'message' && activity.author === 'user'
        ? 'You steered the work'
        : activity.type === 'question'
          ? 'Athena asked'
          : activity.type === 'error'
            ? 'Athena stopped'
            : 'Progress',
    detail: activity.text,
    createdAt: activity.createdAt,
  };
}

/** Build the dense workbench presentation for one personal Athena session. */
export function presentAthenaSession(
  session: PersonalAthenaSessionDetail,
): AthenaSessionPresentation {
  const source = session.context?.source;
  const state = session.queueState ?? athenaQueueState(session.status);
  return {
    id: session.id,
    objective: session.objective,
    stateLabel: STATUS_LABELS[session.status],
    workspaceLabel: session.workspace?.name ?? session.context?.workspaceName ?? null,
    contextLabel: source?.label ?? null,
    decision: session.decision ?? null,
    activity: session.activities
      .map(presentAthenaActivity)
      .filter((entry): entry is AthenaActivityPresentation => entry !== null),
    result: session.result ?? null,
    canPause: session.status === 'running',
    canResume: session.status === 'awaiting_input',
    canCancel: state !== 'finished',
    commandLabel:
      state === 'finished'
        ? 'Continue from this result'
        : state === 'needs_you'
          ? 'Add context or answer'
          : 'Steer this work',
  };
}
