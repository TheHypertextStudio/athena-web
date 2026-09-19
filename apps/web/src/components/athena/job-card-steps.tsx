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

/** Shared Undo control: a ghost button before reversal, an "Undone" badge after. */
export function StepUndo({
  changeSetId,
  undone,
  pending,
  onUndo,
}: {
  readonly changeSetId: string;
  readonly undone: boolean;
  readonly pending: boolean;
  readonly onUndo: (changeSetId: string) => void;
}): JSX.Element {
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
  /** Show every step regardless of count: the job is finished, or the card was asked to expand. */
  readonly forceExpanded: boolean;
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

/**
 * One step in the card's work log: title, detail, an MCP app card when the tool call left one,
 * Undo when the step's change is still reversible, and the technical disclosure — lifted from the
 * workbench's work log and relabelled "What Athena used".
 */
function JobStepRow({
  entry,
  changeSetId,
  undone,
  undoPending,
  onUndo,
}: JobStepRowProps): JSX.Element {
  return (
    <li className="py-3 first:pt-0">
      <p className="text-on-surface text-body-medium break-words">{entry.title}</p>
      {entry.detail ? (
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
            What Athena used
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
 * The card's step list: collapsed behind a "N steps" trigger, one level of nesting deep.
 *
 * @remarks
 * Steps are the job entry's history, not its running status — the status line above already says
 * what is happening now, so nothing here duplicates it. Collapsed by default so a long-running or
 * many-stepped job never grows the thread on its own; `forceExpanded` opens it from the start for a
 * caller that wants every step visible immediately (the finished-job and wide-view cases).
 */
export function JobSteps({
  activities,
  forceExpanded,
  isFinished,
  undoneChangeSetIds,
  undoPending,
  onUndo,
}: JobStepsProps): JSX.Element | null {
  if (activities.length === 0) return null;

  return (
    <Collapsible defaultOpen={forceExpanded}>
      <CollapsibleTrigger className="group text-on-surface-variant text-label-medium hover:text-on-surface flex w-fit items-center gap-1">
        <span>{`${String(activities.length)} steps`}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 transition-transform group-data-[state=open]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol aria-label="What Athena did" className="mt-2">
          {activities.map((entry) => {
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
