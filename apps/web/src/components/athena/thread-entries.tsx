'use client';

/**
 * `thread-entries` — one merged conversation thread: your messages, replies, quiet work lines,
 * work entries, and questions.
 *
 * @remarks
 * Split out of `athena-conversation.tsx` so {@link mergeThreadEntries}'s output has its own home:
 * an activity renders through the chat presentation (your right-aligned bubble, a left-aligned
 * reply with no surface, a quiet work line with its MCP app card, or a plan entry), a job
 * renders as the flat {@link AthenaJobCard} entry, and a question as a flat entry at the time it was
 * asked. Every entry is one level deep. See §4.2 and §4.6 of
 * `docs/superpowers/specs/2026-09-12-athena-companion-design.md`.
 */
import { parseMcpAppPresentation } from '@docket/integrations/mcp-apps-contract';
import { type SessionActivityOut } from '@docket/athena/agent-contract';
import { Text } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { PLAN_TOOL_NAMES } from '@docket/work/plan-draft-contract';

import { McpAppPresentationCard } from '@/components/athena/mcp-app-presentation-card';
import { parsePlanStart } from '@/components/plan-canvas/plan-start-card';
import { capitalizeFirst } from '@/lib/athena/describe-proposal';
import type { ThreadEntry } from '@/lib/athena/job-presentation';
import { personalAthenaTransport, type PersonalAthenaTransport } from '@/lib/athena/query-defs';

import { AthenaJobCard } from './athena-job-card';
import { ThreadQuestion } from './elicitation-queue';
import { ThreadPlanEntry } from './thread-plan-entry';

/** Props for {@link ThreadEntries}. */
export interface ThreadEntriesProps {
  /** The thread's activities, jobs, and questions, merged and ordered by {@link mergeThreadEntries}. */
  readonly entries: readonly ThreadEntry[];
  /** The workspace the thread belongs to, for a question whose task names none. */
  readonly workspaceId: string;
  /** The question a notification landed on, rung and scrolled to. */
  readonly landingQuestionId?: string | null | undefined;
  /** Transport a job entry drives its own detail read and actions through. */
  readonly transport?: PersonalAthenaTransport;
  /** Posts a widget-composed `ui/message` into this thread, as the user. */
  readonly onWidgetMessage: (text: string) => Promise<boolean>;
}

/** Props for {@link ThreadEntryView}. */
interface ThreadEntryViewProps extends Omit<ThreadEntriesProps, 'entries'> {
  readonly entry: ThreadEntry;
  readonly transport: PersonalAthenaTransport;
}

/** One merged entry: a work entry, a question, or a conversational beat. */
function ThreadEntryView({
  entry,
  workspaceId,
  landingQuestionId,
  transport,
  onWidgetMessage,
}: ThreadEntryViewProps): JSX.Element | null {
  if (entry.kind === 'job') return <AthenaJobCard job={entry.job} transport={transport} />;
  if (entry.kind === 'question') {
    return (
      <ThreadQuestion
        question={entry.question}
        workspaceId={workspaceId}
        focused={entry.question.id === landingQuestionId}
      />
    );
  }
  return <ChatEntry activity={entry.activity} onWidgetMessage={onWidgetMessage} />;
}

/** The key one merged entry renders under, unique across the three kinds. */
function entryKey(entry: ThreadEntry): string {
  if (entry.kind === 'job') return `job-${entry.job.id}`;
  if (entry.kind === 'question') return `question-${entry.question.id}`;
  return entry.activity.id;
}

/** Render the thread's merged entries, in the order {@link mergeThreadEntries} gave them. */
export function ThreadEntries({
  entries,
  transport = personalAthenaTransport,
  ...rest
}: ThreadEntriesProps): JSX.Element {
  return (
    <>
      {entries.map((entry) => (
        <ThreadEntryView key={entryKey(entry)} entry={entry} transport={transport} {...rest} />
      ))}
    </>
  );
}

/** Props for {@link ChatEntry}. */
interface ChatEntryProps {
  activity: SessionActivityOut;
  /** Posts a widget-composed `ui/message` into this thread, as the user. */
  onWidgetMessage: (text: string) => Promise<boolean>;
}

/** Read one nested object off an untrusted activity body. */
function bodyRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

/**
 * The plan a `plan_start` action opened, when the action was one and succeeded.
 *
 * @remarks
 * Athena's offer to plan on the canvas is the tool result itself: a durable card that links to the
 * plan route, so opening it is the yes and a reload finds it where it was.
 */
function startedPlanFrom(
  action: Readonly<Record<string, unknown>> | null,
  result: Readonly<Record<string, unknown>> | null,
): ReturnType<typeof parsePlanStart> {
  if (action?.['kind'] !== PLAN_TOOL_NAMES.start || result?.['isError'] === true) return null;
  return parsePlanStart(result?.['content']);
}

/** One conversational beat: user bubble, Athena text, quiet work chip, or question. */
function ChatEntry({ activity, onWidgetMessage }: ChatEntryProps): JSX.Element | null {
  const text = typeof activity.body['text'] === 'string' ? activity.body['text'] : '';
  const fromUser = activity.body['author'] === 'user';

  if (activity.type === 'response' && fromUser) {
    return (
      <div className="bg-primary text-on-primary text-body-medium rounded-corner-lg rounded-br-corner-xs ml-auto max-w-[85%] px-4 py-2.5 whitespace-pre-wrap">
        {text}
      </div>
    );
  }
  if (activity.type === 'response' || activity.type === 'elicitation') {
    return (
      <p className="text-on-surface text-body-medium mr-auto max-w-160 whitespace-pre-wrap">
        {text}
      </p>
    );
  }
  if (activity.type === 'error') {
    return (
      <Text token="body-medium" tone="error" className="mr-auto">
        {text || 'Athena hit an error.'}
      </Text>
    );
  }
  if (activity.type === 'action') {
    return <ActionEntry activity={activity} onWidgetMessage={onWidgetMessage} />;
  }
  // Thoughts stay out of the conversation — the work-log session view carries them.
  return null;
}

/** What one `action` activity has to show: its chip text and whatever durable card it produced. */
interface ActionPresentation {
  /** The chip text, capitalized and ready to render — meaningless when `isProposal`. */
  readonly summary: string;
  /** Whether this action is a gated proposal, whose record is the `ProposalGroupCard` above. */
  readonly isProposal: boolean;
  /** The interactive MCP app card this tool call captured, when it captured one. */
  readonly presentation: ReturnType<typeof parseMcpAppPresentation>;
  /** Whether the tool captured a presentation the card failed to parse. */
  readonly presentationUnavailable: boolean;
  /** The plan a `plan_start` action opened, when this action was one and it succeeded. */
  readonly startedPlan: ReturnType<typeof parsePlanStart>;
}

/** Derive everything one `action` activity's entry needs from its untrusted JSON body. */
function deriveActionPresentation(
  action: Readonly<Record<string, unknown>> | null,
): ActionPresentation {
  const summary = action && typeof action['summary'] === 'string' ? action['summary'] : 'worked';
  // The chip stays the quiet record of what Athena did; when the tool captured an interactive
  // MCP app card, it renders full-width beneath the chip — the same durable presentation the
  // job card shows, revalidated here because the body is an untrusted bag of JSON.
  const result = action ? bodyRecord(action['result']) : null;
  const presentation = parseMcpAppPresentation(result?.['presentation']);
  return {
    summary: capitalizeFirst(summary),
    isProposal: action?.['mode'] === 'proposal',
    presentation,
    presentationUnavailable:
      result?.['presentationUnavailable'] === true ||
      (result?.['presentation'] !== undefined && !presentation),
    startedPlan: startedPlanFrom(action, result),
  };
}

/** Props for {@link WorkChip}. */
interface WorkChipProps {
  readonly summary: string;
}

/** The quiet line naming a step of the conversation's own work — plain text, no pill. */
function WorkChip({ summary }: WorkChipProps): JSX.Element {
  return (
    <span className="text-on-surface-variant text-body-small mr-auto block max-w-full truncate">
      {summary}
    </span>
  );
}

/** Props for {@link ActionCards}. */
interface ActionCardsProps {
  readonly presentation: ActionPresentation;
  readonly activityId: string;
  readonly onWidgetMessage: ChatEntryProps['onWidgetMessage'];
}

/** The durable cards a tool call produced: a started plan, and/or an MCP app presentation. */
function ActionCards({ presentation, activityId, onWidgetMessage }: ActionCardsProps): JSX.Element {
  return (
    <>
      {presentation.startedPlan ? <ThreadPlanEntry plan={presentation.startedPlan} /> : null}
      {presentation.presentation ? (
        <McpAppPresentationCard
          presentation={presentation.presentation}
          activityId={activityId}
          onMessage={onWidgetMessage}
        />
      ) : null}
      {!presentation.presentation && presentation.presentationUnavailable ? (
        <p className="text-on-surface-variant text-body-small" data-testid="mcp-app-view-failure">
          Interactive view unavailable.
        </p>
      ) : null}
    </>
  );
}

/**
 * The quiet work chip for one tool call, with whatever durable card the call produced.
 *
 * @remarks
 * A `proposal`-mode action already has its record: the `ProposalGroupCard` rendered above the
 * thread. Repeating it here as a chip was the raw tool name shown twice for the same change, so
 * a proposal action renders only whatever durable record the call produced (a plan entry, an
 * MCP app presentation) and no chip at all.
 */
function ActionEntry({ activity, onWidgetMessage }: ChatEntryProps): JSX.Element | null {
  const action = bodyRecord(activity.body['action']);
  const presentation = deriveActionPresentation(action);
  const { isProposal, startedPlan, presentationUnavailable } = presentation;

  if (isProposal && !startedPlan && !presentation.presentation && !presentationUnavailable) {
    return null;
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {/* A started plan is its own entry, so the chip naming the same call would say it twice. */}
      {isProposal || startedPlan ? null : <WorkChip summary={presentation.summary} />}
      <ActionCards
        presentation={presentation}
        activityId={activity.id}
        onWidgetMessage={onWidgetMessage}
      />
    </div>
  );
}
