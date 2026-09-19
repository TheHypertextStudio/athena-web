'use client';

/**
 * A work entry's step disclosure, split out of `job-card-parts.tsx` to keep that file under the
 * complexity and length ceilings.
 *
 * @remarks
 * Undo lives here rather than on `AthenaJobCard` itself: a step's change is only ever reversible
 * once the job is finished, and the same {@link StepUndo} control also backs the receipt's own
 * Undo in `job-card-parts.tsx` — see §4.6 of the companion design.
 */
import { ChevronDown } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  focusRing,
  surfaceToneColor,
} from '@docket/ui/primitives';
import { type JSX } from 'react';

import { McpAppPresentationCard } from '@/components/athena/mcp-app-presentation-card';
import { ProposalInputRows } from '@/components/athena/proposal-input-rows';
import { countLabel } from '@/lib/athena/job-presentation';
import type { AthenaActivityPresentation } from '@/lib/athena/presentation';
import { postWidgetMessage } from '@/lib/athena/mcp-app-defs';

/** Read the change set a step's tool call recorded, when it recorded one. */
function changeSetIdFromTechnical(
  technical: AthenaActivityPresentation['technical'],
): string | null {
  return technical?.changeSetId ?? null;
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

/** Shared Undo control: a text button before reversal, the word "Undone" after. */
export function StepUndo({ changeSetId, undone, pending, onUndo }: StepUndoProps): JSX.Element {
  if (undone) {
    return <span className="text-on-surface-variant text-label-medium">Undone</span>;
  }
  return (
    <Button
      type="button"
      variant="ghost"
      controlSize="md"
      className="-ml-3 w-fit"
      disabled={pending}
      onClick={() => {
        onUndo(changeSetId);
      }}
    >
      Undo
    </Button>
  );
}

/**
 * The labelled rows a step's Details disclosure shows: which tool ran, and what it was given.
 *
 * @remarks
 * A failed step's result is left out — that text is the tool's or provider's, and a failure's
 * text is never shown verbatim. A successful step's plain-text result is shown as "result".
 */
function stepDetailRows(entry: AthenaActivityPresentation): Readonly<Record<string, unknown>> {
  const technical = entry.technical;
  const input =
    technical?.input && typeof technical.input === 'object'
      ? (technical.input as Readonly<Record<string, unknown>>)
      : {};
  const output = entry.failed ? undefined : technical?.output;
  return {
    ...(technical?.toolName ? { tool: technical.toolName } : {}),
    ...input,
    ...(typeof output === 'string' ? { result: output } : {}),
  };
}

/** Props for {@link StepDetails}. */
interface StepDetailsProps {
  readonly entry: AthenaActivityPresentation;
}

/** A step's "Details" disclosure: its raw call as labelled rows, never a JSON dump. */
function StepDetails({ entry }: StepDetailsProps): JSX.Element | null {
  const rows = stepDetailRows(entry);
  if (Object.keys(rows).length === 0) return null;
  return (
    <Collapsible>
      <CollapsibleTrigger
        className={cn(
          'text-on-surface-variant text-label-medium hover:text-on-surface -my-2 flex min-h-10 w-fit items-center gap-1 rounded-md',
          focusRing,
        )}
      >
        Details
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ProposalInputRows input={rows} className={surfaceToneColor('floating')} />
      </CollapsibleContent>
    </Collapsible>
  );
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

/** Whether a step is a sentence of its own (a progress beat or Athena's message), with no label. */
function isNarration(entry: AthenaActivityPresentation): boolean {
  return entry.kind === 'progress' || (entry.kind === 'message' && !isUserMessageRow(entry));
}

/**
 * The step's primary line: a narration shows only its own text, a follow-up message from the
 * person reads "You: <text>", and every other kind shows its presented title.
 */
function stepHeading(entry: AthenaActivityPresentation): string | null {
  if (isNarration(entry)) return entry.detail ?? null;
  if (isUserMessageRow(entry)) return `You: ${entry.detail ?? ''}`;
  return entry.title;
}

/** Whether a step keeps a second, muted detail line under its heading. */
function showsDetailLine(entry: AthenaActivityPresentation): boolean {
  return !isNarration(entry) && !isUserMessageRow(entry) && Boolean(entry.detail);
}

/** The interactive card a step's tool call left, or a line saying it could not be shown. */
function StepPresentation({ entry }: StepDetailsProps): JSX.Element | null {
  if (entry.presentation) {
    return (
      <McpAppPresentationCard
        presentation={entry.presentation}
        activityId={entry.id}
        onMessage={postWidgetMessage}
      />
    );
  }
  if (!entry.presentationUnavailable) return null;
  return (
    <p className="text-on-surface-variant text-body-small" data-testid="mcp-app-view-failure">
      Interactive view unavailable.
    </p>
  );
}

/** One step: its heading, a detail line, any app card, Undo, and the Details disclosure. */
function JobStepRow({
  entry,
  changeSetId,
  undone,
  undoPending,
  onUndo,
}: JobStepRowProps): JSX.Element {
  const heading = stepHeading(entry);
  return (
    <li className="flex flex-col gap-1">
      {heading === null ? null : (
        <p
          className={cn(
            'text-body-small break-words',
            entry.failed ? 'text-error' : 'text-on-surface',
          )}
        >
          {heading}
        </p>
      )}
      {showsDetailLine(entry) ? (
        <p className="text-on-surface-variant text-body-small break-words whitespace-pre-wrap">
          {entry.detail}
        </p>
      ) : null}
      <StepPresentation entry={entry} />
      {changeSetId ? (
        <StepUndo changeSetId={changeSetId} undone={undone} pending={undoPending} onUndo={onUndo} />
      ) : null}
      {entry.technical ? <StepDetails entry={entry} /> : null}
    </li>
  );
}

/** Props for {@link JobSteps}. */
export interface JobStepsProps {
  /** The entry's steps, oldest first — the same shape the workbench's work log renders. */
  readonly activities: readonly AthenaActivityPresentation[];
  /** The job has left every lifecycle state — only a finished step's change offers Undo. */
  readonly isFinished: boolean;
  /** Change sets already reversed this session, so their step shows "Undone" instead of Undo. */
  readonly undoneChangeSetIds: ReadonlySet<string>;
  /** Whether an undo request is in flight, disabling every Undo control while it settles. */
  readonly undoPending: boolean;
  readonly onUndo: (changeSetId: string) => void;
}

/**
 * The entry's step disclosure: "1 step" / "3 steps", collapsed until a person opens it.
 *
 * @remarks
 * Drops the job's own initiating message from the list: that message is the objective the entry
 * already renders as its title. Any later message from the person still renders, as "You: <text>".
 * The count in the trigger reflects what is actually shown once opened.
 */
export function JobSteps({
  activities,
  isFinished,
  undoneChangeSetIds,
  undoPending,
  onUndo,
}: JobStepsProps): JSX.Element | null {
  const initiatingMessageId = activities.find(isUserMessageRow)?.id ?? null;
  const visibleActivities = activities.filter((entry) => entry.id !== initiatingMessageId);

  if (visibleActivities.length === 0) return null;

  return (
    <Collapsible>
      <CollapsibleTrigger
        className={cn(
          'group text-on-surface-variant text-label-medium hover:text-on-surface -my-2 flex min-h-10 w-fit items-center gap-1 rounded-md',
          focusRing,
        )}
      >
        <span>{countLabel(visibleActivities.length, 'step')}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol aria-label="Steps" className="flex flex-col gap-3 pt-2">
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
