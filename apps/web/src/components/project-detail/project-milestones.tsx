'use client';

/**
 * The project Overview's Milestones section — the project's checkpoints as a dense, scannable list.
 *
 * @remarks
 * This panel used to be the *only* place a milestone existed, so it carried every editor a milestone
 * could need: an inline title field, a date picker, a Markdown body editor, and a bespoke
 * progressive-disclosure add form, all stacked inside a bordered box per milestone. That made each
 * milestone a card in a product whose workhorse surface is the row, and the embedded Markdown editor
 * reserved multi-line height in every one of them.
 *
 * Now it is a list of disclosures. Collapsed, a milestone is one dense row: name, target date,
 * progress. Expanded, the same row grows its note editor and date picker in place. A milestone is
 * part of a project, so it is read and edited *on* the project — not at an address of its own, and
 * not in an overlay that covers the project to show you something that belongs to it.
 *
 * ## Separate, but grouped
 *
 * Each milestone is one `surface-container-low` block on the page ground, gap-separated from its
 * neighbours. The heading above them is what groups them — the same shape every other Overview
 * section takes (`project-dependencies.tsx` is a bare `<section>` with a heading and nothing else),
 * so there is no second container wrapping what a heading has already gathered. Nesting a group
 * surface inside a headed section only to nest the items inside that is two containers doing one
 * job.
 *
 * No line is drawn for any of it: §8 is explicit that grouping and separation are a tonal step, not
 * a border. Hairline-divided rows on one flat panel read as a table, and three checkpoints are not
 * a table.
 *
 * The blocks take the 8px control radius rather than a panel's 14px. They are list items, not
 * cards, and the tighter corner is what keeps a column of them reading as a list.
 *
 * An open milestone steps up one tone, to `surface-container`. The disclosure already says which one
 * is open; the tone says it without the reader having to find the chevron.
 *
 * A row carries no icon of its own. An entity glyph is an identity badge — it tells you *which kind
 * of thing* a row is in a list that mixes kinds, and it gives a project or a task something to be
 * recognized by elsewhere in the product. Every row in this list is a milestone of this one project,
 * so a column of identical flags says nothing, and a milestone appears nowhere else to be recognized
 * in. The chevron is the only leading mark, which is the one thing a reader needs here: where to
 * click.
 *
 * Removing has no confirm dialog, matching the API's own framing of deletion as lightweight (a
 * milestone's tasks just lose the reference, they aren't touched) and the dependency panel's
 * precedent. The detail page, where a delete is further from the thing being deleted and takes the
 * open document with it, does confirm.
 */
import { type MilestoneOut } from '@docket/work/milestone-contract';
import { RowMeta, RowProgress } from '@docket/ui/components';
import { cn } from '@docket/ui/lib/utils';
import { ChevronRight, Flag, Trash2 } from '@docket/ui/icons';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DecorativeIcon,
  focusRing,
} from '@docket/ui/primitives';
import type { QueryKey } from '@tanstack/react-query';
import { type JSX, useMemo, useState } from 'react';

import type { MilestoneTask } from '@/components/project-detail/milestone-tasks';
import { DatePicker } from '@docket/ui/components';
import { EditableFreeformText } from '@/components/editor/freeform-text';
import { ExcerptMarkdown } from '@/components/mentions/excerpt-markdown';
import { QuickAddRow } from '@/components/views/quick-add-row';
import { formatCalendarDate } from '@/lib/format-date';
import { useCategoryOf } from '@/components/entity-display/use-work-status';
import { countTasksByMilestone } from '@/lib/milestone-progress';
import { milestoneTargetDate, useMilestoneDetail } from '@/lib/use-milestone-detail';
import { useProjectMilestones } from '@/lib/use-project-milestones';

/** The synthesized bucket id for tasks with no milestone (mirrors the Tasks tab). */
const UNSCHEDULED_KEY = '__unscheduled__';

/** A milestone nothing points at yet. */
const zeroProgress = { done: 0, total: 0 } as const;

/** Removal is the list's job, so a row's own hook has no delete completion to run. */
function noop(): void {
  // Intentionally empty.
}

/** Props for the private {@link MilestoneRow}. */
interface MilestoneRowProps {
  orgId: string;
  projectId: string;
  milestone: MilestoneOut;
  /** Completed / total tasks pointing at this milestone. */
  progress: { readonly done: number; readonly total: number };
  /** The vocabulary-skinned lowercase task noun. */
  taskNoun: string;
  canEdit: boolean;
  /** Whether a list mutation is in flight, which disables removal. */
  removing: boolean;
  onRemove: () => void;
}

/**
 * One milestone, collapsed to a row and expanded in place.
 *
 * @remarks
 * The disclosure is the whole point: a project's checkpoints are a list you scan, and any one of
 * them is a note you occasionally read. Collapsed, every milestone costs one row. Expanded, it
 * grows the same document editor every other body uses — without covering the project it belongs
 * to, and without sending anyone to a second surface to read two sentences.
 *
 * Composed directly rather than through {@link EntityListRow}: this row has to *be* a tonal block
 * with its own shape, and that component owns its container's chrome through two fixed tones
 * (hairline dividers or a shared card) — neither of which is a separated, individually-rounded
 * block. The slot vocabulary is kept by hand at the documented row rhythm (`min-h-9`, `px-3`,
 * `gap-2`), and `RowMeta`/`RowProgress` still supply the meta band so the numbers align with every
 * other list in the product.
 *
 * The trigger wraps the identity, not the whole block, so the remove button beside it is a sibling
 * control rather than a control nested inside one.
 */
function MilestoneRow({
  orgId,
  projectId,
  milestone,
  progress,
  taskNoun,
  canEdit,
  removing,
  onRemove,
}: MilestoneRowProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const { patch, mutationError } = useMilestoneDetail(orgId, milestone.id, projectId, noop);
  const targetDate = milestoneTargetDate(milestone);
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(
        // One step above the page at rest, another when open. `rounded-md` is the 8px control
        // radius — a list item's corner, not a panel's — see the module header.
        'group/milestone min-w-0 rounded-md transition-colors',
        open ? 'bg-surface-container' : 'bg-surface-container-low hover:bg-surface-container',
      )}
    >
      <div className="flex min-h-9 min-w-0 items-center gap-2 py-1.5 pr-2 pl-3">
        <CollapsibleTrigger
          className={cn(
            'group/disclosure flex min-w-0 flex-1 items-center gap-2 rounded-md text-left',
            focusRing,
          )}
        >
          <ChevronRight
            aria-hidden
            className="text-on-surface-variant size-4 shrink-0 transition-transform group-data-[state=open]/disclosure:rotate-90"
          />
          <span className="flex min-w-0 flex-col">
            <span className="text-on-surface text-label-large min-w-0 truncate">
              {milestone.name}
            </span>
            {open || milestone.description === null ? null : (
              // Markdown source, so printing it raw would read as `**Feature freeze**`. Hidden
              // while open: the editor below is already showing the whole note.
              <ExcerptMarkdown
                value={milestone.description}
                className="text-on-surface-variant text-body-small truncate"
              />
            )}
          </span>
        </CollapsibleTrigger>

        <span className="text-on-surface-variant text-label-small hidden shrink-0 items-center gap-x-4 sm:flex">
          {open || targetDate === null ? null : (
            <RowMeta tabular>{formatCalendarDate(targetDate)}</RowMeta>
          )}
          {progress.total === 0 ? null : (
            <RowMeta tabular>
              <RowProgress
                value={pct}
                label={`${milestone.name} ${taskNoun} completion`}
                fillClassName="bg-state-completed"
              />
              {progress.done}/{progress.total}
            </RowMeta>
          )}
        </span>

        {canEdit ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove ${milestone.name}`}
            disabled={removing}
            className="shrink-0 opacity-0 transition-opacity group-focus-within/milestone:opacity-100 group-hover/milestone:opacity-100"
            onClick={onRemove}
          >
            <Trash2 className="size-4" />
          </Button>
        ) : null}
      </div>

      {/* Indented past the chevron, so the body reads as belonging to the row above it. */}
      <CollapsibleContent className="flex flex-col items-start gap-1 pr-3 pb-2 pl-9">
        <DatePicker
          value={targetDate}
          onChange={(next) => {
            patch({ targetDate: next });
          }}
          placeholder="Set target date"
          formatLabel={(value) => formatCalendarDate(value) ?? undefined}
          ariaLabel={`${milestone.name} target date`}
          readOnly={!canEdit}
          triggerVariant="ghost"
          // The ghost trigger carries its own `px-2`, which would set the date 8px further in than
          // the note under it. Pulled back so both start on the same line.
          triggerClassName="-ml-2"
        />
        <EditableFreeformText
          className="w-full"
          compact
          value={milestone.description}
          placeholder="Describe this milestone…"
          canEdit={canEdit}
          onSave={(description) => {
            patch({ description });
          }}
        />
        {mutationError ? (
          <p role="alert" className="text-error text-body-medium">
            {mutationError}
          </p>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Props for {@link ProjectMilestonesPanel}. */
export interface ProjectMilestonesPanelProps {
  orgId: string;
  projectId: string;
  /** The project-detail query key to invalidate after any milestone mutation. */
  projectDetailKey: QueryKey;
  /** The project's milestones, in any order (sorted here by their `sort` key). */
  milestones: readonly MilestoneOut[];
  /** The project's tasks, each with its resolved milestone, for the per-row progress bar. */
  milestoneTasks: readonly MilestoneTask[];
  /** The vocabulary-skinned lowercase task noun, for the editor's progress line. */
  taskNoun: string;
  /** Whether the viewer may create/edit/delete milestones. */
  canEdit: boolean;
}

/** The Overview-tab Milestones list: the project's checkpoints, plus add and remove. */
export function ProjectMilestonesPanel({
  orgId,
  projectId,
  projectDetailKey,
  milestones,
  milestoneTasks,
  taskNoun,
  canEdit,
}: ProjectMilestonesPanelProps): JSX.Element {
  const { create, remove, pending, mutationError } = useProjectMilestones(
    orgId,
    projectId,
    projectDetailKey,
  );

  const categoryOf = useCategoryOf('task');
  const progressByMilestone = useMemo(
    () => countTasksByMilestone(milestoneTasks, UNSCHEDULED_KEY, categoryOf),
    [milestoneTasks, categoryOf],
  );

  const ordered = useMemo(() => [...milestones].sort((a, b) => a.sort - b.sort), [milestones]);
  const nextSort = useMemo(
    () => ordered.reduce((highest, milestone) => Math.max(highest, milestone.sort), -1) + 1,
    [ordered],
  );
  return (
    <section aria-label="Milestones" className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <DecorativeIcon icon={Flag} />
        <h2 className="text-on-surface text-title-small">Milestones</h2>
      </div>

      {ordered.length === 0 ? (
        <p className="text-on-surface-variant text-body-medium">
          No milestones yet — add checkpoints to track this project&apos;s key dates.
        </p>
      ) : (
        <div role="group" aria-label="Milestones" className="flex flex-col gap-2">
          {ordered.map((milestone) => (
            <MilestoneRow
              key={milestone.id}
              orgId={orgId}
              projectId={projectId}
              milestone={milestone}
              progress={progressByMilestone.get(milestone.id) ?? zeroProgress}
              taskNoun={taskNoun}
              canEdit={canEdit}
              removing={pending}
              onRemove={() => {
                remove(milestone.id);
              }}
            />
          ))}
        </div>
      )}

      <QuickAddRow
        // The highest position in use, not the count: the API never renumbers after a delete, so
        // a list of 0 and 2 has length 2 and would hand the next milestone a colliding sort.
        onAdd={(name) => create({ name, sort: nextSort })}
        canEdit={canEdit}
        noun="milestone"
      />

      {mutationError ? (
        <p role="alert" className="text-error text-body-medium">
          {mutationError}
        </p>
      ) : null}
    </section>
  );
}
