'use client';

/** Optional model review tied to the editable plan, with explicit task-composer actions. */
import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import type { TaskOut } from '@docket/work/task-model';
import { EntityList, EntityListRow } from '@docket/ui/components';
import { ChevronDown, MoreHorizontal } from '@docket/ui/icons';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  focusRing,
} from '@docket/ui/primitives';
import type { JSX, MouseEvent } from 'react';
import { useCreateObject } from '@/components/create-object/create-object-provider';
import {
  useDailyPlanningAssessment,
  type DailyAssessmentSuggestion,
} from './use-daily-planning-assessment';

/** Review input and the task-creation continuation owned by the planner. */
export interface DailyPlanningAssessmentProps {
  readonly draft: DailyPlanSnapshot;
  readonly proposalToken?: string;
  readonly onTaskCreated: (task: TaskOut) => void;
}

function SuggestedTask({
  suggestion,
  onAdd,
  onDismiss,
}: {
  readonly suggestion: DailyAssessmentSuggestion;
  readonly onAdd: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly onDismiss: () => void;
}): JSX.Element {
  return (
    <EntityListRow
      interactive={false}
      title={suggestion.title}
      subtitle={`${suggestion.projectName} · ${suggestion.reason}`}
      trailing={
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="secondary"
            aria-label={`Add ${suggestion.title}`}
            onClick={onAdd}
          >
            Add
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Dismiss ${suggestion.title}`}
            onClick={onDismiss}
          >
            Dismiss
          </Button>
        </div>
      }
    />
  );
}

function AssessmentRequest({
  pending,
  requestAgain,
}: {
  readonly pending: boolean;
  readonly requestAgain: () => void;
}): JSX.Element {
  if (pending)
    return (
      <span role="status" className="sr-only">
        Athena is reviewing this plan.
      </span>
    );
  return (
    <Collapsible>
      <CollapsibleTrigger
        className={`text-on-surface-variant text-label-medium group flex min-h-10 items-center gap-1 ${focusRing}`}
      >
        Athena
        <ChevronDown
          aria-hidden="true"
          className="size-4 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Button size="sm" variant="ghost" onClick={requestAgain}>
          Ask Athena
        </Button>
      </CollapsibleContent>
    </Collapsible>
  );
}

function AssessmentActions({ dismissNote }: { readonly dismissNote: () => void }): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          controlSize="sm"
          iconOnly
          aria-label="Athena assessment actions"
          className="text-on-surface-variant"
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={dismissNote}>Dismiss assessment</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Request Athena asynchronously and discard the note immediately after a material plan edit. */
export function DailyPlanningAssessment({
  draft,
  proposalToken,
  onTaskCreated,
}: DailyPlanningAssessmentProps): JSX.Element | null {
  const { openCreate } = useCreateObject();
  const { note, suggestions, pending, requestAgain, dismissNote, dismissTask } =
    useDailyPlanningAssessment(draft, proposalToken);
  const addTask = (
    suggestion: DailyAssessmentSuggestion,
    event: MouseEvent<HTMLButtonElement>,
  ): void => {
    openCreate(
      {
        kind: 'task',
        initialWorkspaceId: suggestion.organizationId,
        sameWorkspaceCompletion: 'stay',
        defaultProjectId: suggestion.projectId,
        initialTitle: suggestion.title,
        onCreated: (task) => {
          dismissTask(suggestion);
          onTaskCreated(task);
        },
      },
      event.currentTarget,
    );
  };
  if (!note && suggestions.length === 0)
    return <AssessmentRequest pending={pending} requestAgain={requestAgain} />;
  return (
    <section aria-label="Athena assessment" className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <strong className="text-on-surface-variant text-label-medium">Athena</strong>
        {note ? <AssessmentActions dismissNote={dismissNote} /> : null}
      </div>
      {note ? <p className="text-body-medium">{note}</p> : null}
      {suggestions.length > 0 ? (
        <EntityList aria-label="Athena task suggestions">
          {suggestions.map((suggestion) => (
            <SuggestedTask
              key={`${suggestion.projectId}:${suggestion.title}`}
              suggestion={suggestion}
              onDismiss={() => {
                dismissTask(suggestion);
              }}
              onAdd={(event) => {
                addTask(suggestion, event);
              }}
            />
          ))}
        </EntityList>
      ) : null}
    </section>
  );
}
