import type {
  PersonalAthenaActivity,
  PersonalAthenaSource,
  PersonalAthenaSessionDetail,
  PersonalAthenaSessionSummary,
  PersonalAthenaStatus,
} from './presentation';

/** Personal session summary shape returned by the API lane before generated client integration. */
export interface AthenaApiSessionSummary {
  readonly id: string;
  readonly kind: 'chat' | 'job';
  readonly status: PersonalAthenaStatus;
  readonly queueState: 'needs_you' | 'working' | 'finished';
  readonly objective: string | null;
  readonly context: {
    readonly workspaceId?: string;
    readonly source?: { readonly type: PersonalAthenaSource['type']; readonly id: string };
  } | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly createdAt: string;
}

/** Existing session activity shape returned inside a personal detail. */
export interface AthenaApiActivity {
  readonly id: string;
  readonly type: 'thought' | 'action' | 'response' | 'elicitation' | 'error';
  readonly body: Readonly<Record<string, unknown>>;
  readonly approvalStatus?: string | null;
  readonly createdAt: string;
}

/** Personal detail shape returned by the API lane. */
export interface AthenaApiSessionDetail extends AthenaApiSessionSummary {
  readonly activities: readonly AthenaApiActivity[];
}

/** Grouped personal queue response from `GET /v1/me/athena`. */
export interface AthenaApiOverview {
  readonly counts: {
    readonly needsYou: number;
    readonly working: number;
    readonly finished: number;
  };
  readonly currentChat: AthenaApiSessionSummary | null;
  readonly sessions: {
    readonly needsYou: readonly AthenaApiSessionSummary[];
    readonly working: readonly AthenaApiSessionSummary[];
    readonly finished: readonly AthenaApiSessionSummary[];
  };
}

/** Presentation-ready grouped queue. */
export interface AdaptedAthenaOverview {
  readonly counts: AthenaApiOverview['counts'];
  readonly currentChat: PersonalAthenaSessionSummary | null;
  readonly sessions: {
    readonly needsYou: readonly PersonalAthenaSessionSummary[];
    readonly working: readonly PersonalAthenaSessionSummary[];
    readonly finished: readonly PersonalAthenaSessionSummary[];
  };
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object'
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Turn a connection identifier into a restrained service label. */
function serviceLabel(value: string | null): string {
  if (!value) return 'Docket';
  const tail = value.split(/[/:]/).filter(Boolean).at(-1) ?? value;
  return tail.replaceAll(/[-_]+/g, ' ').replaceAll(/\b\w/g, (character) => character.toUpperCase());
}

/** Adapt one nullable-object API summary to the stable presentation model. */
export function adaptAthenaSummary(summary: AthenaApiSessionSummary): PersonalAthenaSessionSummary {
  const source = summary.context?.source;
  const validSource = source ? { type: source.type, id: source.id } : undefined;
  const objective = summary.objective?.trim();
  return {
    id: summary.id,
    objective: objective && objective.length > 0 ? objective : 'Untitled Athena work',
    status: summary.status,
    queueState: summary.queueState,
    workspace: null,
    context: summary.context
      ? {
          ...(summary.context.workspaceId ? { workspaceId: summary.context.workspaceId } : {}),
          ...(validSource ? { source: validSource } : {}),
        }
      : null,
    createdAt: summary.createdAt,
    updatedAt: summary.endedAt ?? summary.startedAt ?? summary.createdAt,
  };
}

/** Adapt one existing activity to a safe, structured work-log beat. */
export function adaptAthenaActivity(activity: AthenaApiActivity): PersonalAthenaActivity | null {
  if (activity.type === 'thought') return null;
  if (activity.type === 'action') {
    const action = record(activity.body['action']);
    const toolCall = record(action?.['toolCall']);
    const result = record(action?.['result']);
    const summary = string(action?.['summary']) ?? 'Updated your work';
    const connection = string(toolCall?.['connection']);
    const outcome = string(result?.['content']);
    const toolName = string(toolCall?.['tool']);
    return {
      id: activity.id,
      type: 'tool',
      createdAt: activity.createdAt,
      service: serviceLabel(connection),
      action: summary,
      ...(outcome ? { outcome } : {}),
      ...(toolCall
        ? {
            technical: {
              ...(toolName ? { toolName } : {}),
              ...('input' in toolCall ? { input: toolCall['input'] } : {}),
              ...('content' in (result ?? {}) ? { output: result?.['content'] } : {}),
            },
          }
        : {}),
    };
  }
  const text = string(activity.body['text']) ?? string(activity.body['message']) ?? '';
  return {
    id: activity.id,
    type:
      activity.type === 'response'
        ? 'message'
        : activity.type === 'elicitation'
          ? 'question'
          : 'error',
    createdAt: activity.createdAt,
    text,
    ...(activity.type === 'response' && activity.body['author'] === 'user'
      ? { author: 'user' as const }
      : { author: 'athena' as const }),
  };
}

/** Adapt the grouped queue without leaking API-specific nullable fields into React. */
export function adaptAthenaOverview(overview: AthenaApiOverview): AdaptedAthenaOverview {
  return {
    counts: overview.counts,
    currentChat: overview.currentChat ? adaptAthenaSummary(overview.currentChat) : null,
    sessions: {
      needsYou: overview.sessions.needsYou.map(adaptAthenaSummary),
      working: overview.sessions.working.map(adaptAthenaSummary),
      finished: overview.sessions.finished.map(adaptAthenaSummary),
    },
  };
}

/** Adapt personal detail, deriving a structured approval and terminal receipt from visible work. */
export function adaptAthenaDetail(detail: AthenaApiSessionDetail): PersonalAthenaSessionDetail {
  const summary = adaptAthenaSummary(detail);
  const activities = detail.activities
    .map(adaptAthenaActivity)
    .filter((activity): activity is PersonalAthenaActivity => activity !== null);
  const pendingApproval =
    detail.status === 'awaiting_approval'
      ? [...detail.activities]
          .reverse()
          .find((activity) => activity.type === 'action' && activity.approvalStatus !== 'approved')
      : undefined;
  const pendingAction = record(pendingApproval?.body['action']);
  const pendingQuestion =
    detail.status === 'awaiting_input'
      ? [...detail.activities].reverse().find((activity) => activity.type === 'elicitation')
      : undefined;
  const questionOptions = Array.isArray(pendingQuestion?.body['options'])
    ? pendingQuestion.body['options']
        .map((value) => record(value))
        .filter((value): value is Readonly<Record<string, unknown>> => value !== null)
        .map((value) => ({ id: string(value['id']), label: string(value['label']) }))
        .filter(
          (value): value is { readonly id: string; readonly label: string } =>
            value.id !== null && value.label !== null,
        )
    : [];
  const lastNarrative = [...activities]
    .reverse()
    .find((activity) => activity.type !== 'reasoning' && activity.type !== 'tool');
  const lastTool = [...activities].reverse().find((activity) => activity.type === 'tool');
  const resultSummary =
    lastNarrative && 'text' in lastNarrative
      ? lastNarrative.text
      : lastTool && 'outcome' in lastTool
        ? (lastTool.outcome ?? lastTool.action)
        : null;
  return {
    ...summary,
    activities,
    decision: pendingApproval
      ? {
          kind: 'approval',
          id: pendingApproval.id,
          title: string(pendingAction?.['summary']) ?? 'Approve this action',
          description: 'Athena will recheck your current permission before applying it.',
          private: true,
          options: [
            { id: 'approve', label: 'Approve' },
            { id: 'reject', label: 'Reject' },
          ],
        }
      : pendingQuestion && questionOptions.length > 0
        ? {
            kind: 'question',
            id: pendingQuestion.id,
            title: string(pendingQuestion.body['text']) ?? 'Athena needs your answer',
            private: true,
            options: questionOptions,
          }
        : null,
    result:
      detail.queueState === 'finished' && resultSummary
        ? {
            title: detail.status === 'completed' ? 'Work finished' : 'Work stopped',
            summary: resultSummary,
          }
        : null,
  };
}
