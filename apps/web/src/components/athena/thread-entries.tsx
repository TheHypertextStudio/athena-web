'use client';

/**
 * `thread-entries` — one merged conversation thread, rendered as bubbles, quiet work chips, and
 * delegated-work cards.
 *
 * @remarks
 * Split out of `athena-conversation.tsx` so {@link mergeThreadEntries}'s output has its own home:
 * an activity renders through the existing chat presentation (a bubble, a quiet work chip with its
 * MCP app card, or a plan-start card), and a job renders as {@link AthenaJobCard} inside the same
 * bubble treatment Athena's own replies use — it fetches its own detail and drives its own actions
 * independently of the thread around it. See §4.2 and §4.6 of
 * `docs/superpowers/specs/2026-09-12-athena-companion-design.md`.
 */
import { parseMcpAppPresentation } from '@docket/integrations/mcp-apps-contract';
import { type SessionActivityOut } from '@docket/athena/agent-contract';
import { cn } from '@docket/ui/lib/utils';
import { Surface, surfaceToneColor, Text } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { PLAN_TOOL_NAMES } from '@docket/work/plan-draft-contract';

import { McpAppPresentationCard } from '@/components/athena/mcp-app-presentation-card';
import PlanStartCard, { parsePlanStart } from '@/components/plan-canvas/plan-start-card';
import type { ThreadEntry } from '@/lib/athena/job-presentation';
import { personalAthenaTransport, type PersonalAthenaTransport } from '@/lib/athena/query-defs';

import { AthenaJobCard } from './athena-job-card';

/** Props for {@link ThreadEntries}. */
export interface ThreadEntriesProps {
  /** The thread's activities and jobs, merged and ordered by {@link mergeThreadEntries}. */
  readonly entries: readonly ThreadEntry[];
  /** Transport a job entry's card drives its own detail read and actions through. */
  readonly transport?: PersonalAthenaTransport;
  /** Posts a widget-composed `ui/message` into this thread, as the user. */
  readonly onWidgetMessage: (text: string) => Promise<boolean>;
}

/** Render the thread's merged activities and jobs, in the order {@link mergeThreadEntries} gave them. */
export function ThreadEntries({
  entries,
  transport = personalAthenaTransport,
  onWidgetMessage,
}: ThreadEntriesProps): JSX.Element {
  return (
    <>
      {entries.map((entry) =>
        entry.kind === 'job' ? (
          <Surface
            key={`job-${entry.job.id}`}
            tone="canvas"
            shape="medium"
            className="mr-auto w-full max-w-[85%] p-4"
          >
            <AthenaJobCard job={entry.job} transport={transport} />
          </Surface>
        ) : (
          <ChatEntry
            key={entry.activity.id}
            activity={entry.activity}
            onWidgetMessage={onWidgetMessage}
          />
        ),
      )}
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
      <Surface
        tone="canvas"
        shape="medium"
        className="text-body-medium rounded-bl-corner-xs mr-auto max-w-[85%] px-4 py-2.5 whitespace-pre-wrap"
      >
        {text}
      </Surface>
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

/** The quiet work chip for one tool call, with whatever durable card the call produced. */
function ActionEntry({ activity, onWidgetMessage }: ChatEntryProps): JSX.Element {
  const action = bodyRecord(activity.body['action']);
  const summary = action && typeof action['summary'] === 'string' ? action['summary'] : 'worked';
  // The chip stays the quiet record of what Athena did; when the tool captured an interactive
  // MCP app card, it renders full-width beneath the chip — the same durable presentation the
  // job card shows, revalidated here because the body is an untrusted bag of JSON.
  const result = action ? bodyRecord(action['result']) : null;
  const presentation = parseMcpAppPresentation(result?.['presentation']);
  const presentationUnavailable =
    result?.['presentationUnavailable'] === true ||
    (result?.['presentation'] !== undefined && !presentation);
  const startedPlan = startedPlanFrom(action, result);
  return (
    <div className="flex w-full flex-col gap-2">
      <span
        className={cn(
          surfaceToneColor('canvas'),
          'text-on-surface-variant text-label-small mr-auto inline-flex max-w-[85%] items-center gap-1.5 rounded-full px-2.5 py-0.5',
        )}
      >
        <span className="truncate">{summary}</span>
      </span>
      {startedPlan ? <PlanStartCard plan={startedPlan} /> : null}
      {presentation ? (
        <McpAppPresentationCard
          presentation={presentation}
          activityId={activity.id}
          onMessage={onWidgetMessage}
        />
      ) : presentationUnavailable ? (
        <p className="text-on-surface-variant text-body-small" data-testid="mcp-app-view-failure">
          Interactive view unavailable.
        </p>
      ) : null}
    </div>
  );
}
