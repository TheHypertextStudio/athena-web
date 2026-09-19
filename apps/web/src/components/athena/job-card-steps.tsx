'use client';

/**
 * The job card's step list, split out of `job-card-parts.tsx` to keep that file under the
 * complexity and length ceilings.
 *
 * @remarks
 * Undo lives here rather than on `AthenaJobCard` itself: a step's change is only ever reversible
 * once the job is finished, and the same {@link StepUndo} control also backs the receipt's own
 * Undo in `job-card-parts.tsx` — see §4.6 of the companion design.
 */
import { ChevronDown } from '@docket/ui/icons';
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@docket/ui/primitives';
import { type JSX } from 'react';

import { McpAppPresentationCard } from '@/components/athena/mcp-app-presentation-card';
import type { AthenaActivityPresentation } from '@/lib/athena/presentation';
import { postWidgetMessage } from '@/lib/athena/mcp-app-defs';

/** Read the change set a step's tool output recorded, when it recorded one. */
function changeSetIdFromTechnical(
  technical: AthenaActivityPresentation['technical'],
): string | null {
  const output = technical?.output;
  if (!output || typeof output !== 'object') return null;
  const candidate = (output as Record<string, unknown>)['changeSetId'];
  return typeof candidate === 'string' ? candidate : null;
}

/** The newest step's change set, for the receipt's own Undo — the same rule a work log reads. */
export function newestChangeSetId(
  activities: readonly AthenaActivityPresentation[],
): string | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const id = changeSetIdFromTechnical(activities[index]?.technical);
    if (id) return id;
  }
  return null;
}

/**
 * Whether a step is the person's own message, identified by {@link presentAthenaActivity}'s
 * "You asked" title for a `message`-kind entry.
 */
function isUserMessageRow(entry: AthenaActivityPresentation): boolean {
  return entry.kind === 'message' && entry.title === 'You asked';
}

/** Props for {@link StepUndo}. */
interface StepUndoProps {
  readonly changeSetId: string;
  readonly undone: boolean;
  readonly pending: boolean;
  readonly onUndo: (changeSetId: string) => void;
}

/** Shared Undo control: a ghost button before reversal, an "Undone" badge after. */
export function StepUndo({ changeSetId, undone, pending, onUndo }: StepUndoProps): JSX.Element {
  if (undone) return <Badge variant="secondary">Undone</Badge>;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="min-h-10 w-fit"
      disabled={pending}
      onClick={() => {
        onUndo(changeSetId);
      }}
    >
      Undo
    </Button>
  );
}

/** Props for {@link JobSteps}. */
export interface JobStepsProps {
  /** The card's steps, oldest first — the same shape the workbench's work log renders. */
  readonly activities: readonly AthenaActivityPresentation[];
  /** The job has left every lifecycle state — only a finished step's change offers Undo. */
  readonly isFinished: boolean;
  /** Change sets already reversed this session, so their step shows "Undone" instead of Undo. */
  readonly undoneChangeSetIds: ReadonlySet<string>;
  /** Whether an undo request is in flight, disabling every Undo control while it settles. */
  readonly undoPending: boolean;
  readonly onUndo: (changeSetId: string) => void;
}

/** Props for {@link JobStepRow}. */
interface JobStepRowProps {
  readonly entry: AthenaActivityPresentation;
  /** This step's change set, only once the job is finished and the step recorded one. */
  readonly changeSetId: string | null;
  readonly undone: boolean;
  readonly undoPending: boolean;
  readonly onUndo: (changeSetId: string) => void;
}

/** Props for {@link StepRowHeading}. */
interface StepRowHeadingProps {
  readonly entry: AthenaActivityPresentation;
}

/**
 * The step row's primary line: a progress narration shows only its own text (no "Progress"
 * heading), a follow-up message from the person reads "You: <text>", and every other kind shows
 * its presented title — the sentence a tool row, a question, or an error already reads.
 */
function StepRowHeading({ entry }: StepRowHeadingProps): JSX.Element | null {
  if (entry.kind === 'progress') {
    if (!entry.detail) return null;
    return <p className="text-on-surface text-body-medium break-words">{entry.detail}</p>;
  }
  if (isUserMessageRow(entry)) {
    return (
      <p className="text-on-surface text-body-medium break-words">{`You: ${entry.detail ?? ''}`}</p>
    );
  }
  return <p className="text-on-surface text-body-medium break-words">{entry.title}</p>;
}

/**
 * One step in the card's work log: a heading line (see {@link StepRowHeading}), an MCP app card
 * when the tool call left one, Undo when the step's change is still reversible, and the
 * technical disclosure — lifted from the workbench's work log and labelled "Details".
 *
 * @remarks
 * A progress narration and a follow-up message fold their whole text into the heading line, so
 * neither shows a second detail paragraph beneath it; a tool row (and every other kind) keeps
 * its detail line the way the workbench's own work log renders it.
 */
function JobStepRow({
  entry,
  changeSetId,
  undone,
  undoPending,
  onUndo,
}: JobStepRowProps): JSX.Element {
  const showDetailLine = entry.kind !== 'progress' && !isUserMessageRow(entry);
  return (
    <li className="py-3 first:pt-0">
      <StepRowHeading entry={entry} />
      {showDetailLine && entry.detail ? (
        <p className="text-on-surface-variant text-body-medium mt-0.5 break-words whitespace-pre-wrap">
          {entry.detail}
        </p>
      ) : null}
      {entry.presentation ? (
        <div className="mt-3">
          <McpAppPresentationCard
            presentation={entry.presentation}
            activityId={entry.id}
            onMessage={postWidgetMessage}
          />
        </div>
      ) : entry.presentationUnavailable ? (
        <p
          className="text-on-surface-variant text-body-small mt-2"
          data-testid="mcp-app-view-failure"
        >
          Interactive view unavailable.
        </p>
      ) : null}
      {changeSetId ? (
        <div className="mt-2">
          <StepUndo
            changeSetId={changeSetId}
            undone={undone}
            pending={undoPending}
            onUndo={onUndo}
          />
        </div>
      ) : null}
      {entry.technical ? (
        <details className="text-on-surface-variant text-body-small mt-2">
          <summary className="focus-visible:ring-ring min-h-10 w-fit cursor-pointer py-2 focus-visible:ring-2 focus-visible:outline-none">
            Details
          </summary>
          <pre className="text-label-small mt-1 max-w-full overflow-x-auto">
            {JSON.stringify(entry.technical, null, 2)}
          </pre>
        </details>
      ) : null}
    </li>
  );
}

/**
 * The card's step list: collapsed behind a "N steps" trigger, one level of nesting deep, in
 * every lifecycle state — a person opens it themselves; the card never forces it open, whether
 * it is still running or has just finished.
 *
 * @remarks
 * Drops the job's own initiating message from the list: that message is the objective the card
 * already renders as its heading, so repeating it as a step would say the same thing twice. Any
 * later message from the person still renders, as "You: <text>" — see {@link StepRowHeading}.
 * Only the first such message is treated as the initiating one; the count in the "N steps"
 * trigger reflects what is actually shown once opened.
 */
export function JobSteps({
  activities,
  isFinished,
  undoneChangeSetIds,
  undoPending,
  onUndo,
}: JobStepsProps): JSX.Element | null {
  const initiatingMessageId = activities.find(isUserMessageRow)?.id ?? null;
  const visibleActivities = initiatingMessageId
    ? activities.filter((entry) => entry.id !== initiatingMessageId)
    : activities;

  if (visibleActivities.length === 0) return null;

  return (
    <Collapsible>
      <CollapsibleTrigger className="group text-on-surface-variant text-label-medium hover:text-on-surface flex w-fit items-center gap-1">
        <span>{`${String(visibleActivities.length)} steps`}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 transition-transform group-data-[state=open]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol aria-label="What Athena did" className="mt-2">
          {visibleActivities.map((entry) => {
            const changeSetId = isFinished ? changeSetIdFromTechnical(entry.technical) : null;
            return (
              <JobStepRow
                key={entry.id}
                entry={entry}
                changeSetId={changeSetId}
                undone={changeSetId !== null && undoneChangeSetIds.has(changeSetId)}
                undoPending={undoPending}
                onUndo={onUndo}
              />
            );
          })}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}
