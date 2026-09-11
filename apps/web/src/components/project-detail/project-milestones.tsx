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
 * Now it is a list again: one {@link EntityListRow} per milestone, carrying the name, the target
 * date, and a progress bar. Selecting a row opens {@link MilestoneSheet} — a side panel over this
 * project — which is where the name, the date and the full note are edited. A milestone is part of
 * a project, so it is edited *on* the project rather than at an address of its own.
 *
 * Removing has no confirm dialog, matching the API's own framing of deletion as lightweight (a
 * milestone's tasks just lose the reference, they aren't touched) and the dependency panel's
 * precedent. The detail page, where a delete is further from the thing being deleted and takes the
 * open document with it, does confirm.
 */
import { defaultEntityDisplay, type EntityDisplayOut } from '@docket/work/entity-display-contract';
import { type MilestoneOut } from '@docket/work/milestone-contract';
import { EntityList, EntityListRow, RowMeta, RowProgress } from '@docket/ui/components';
import { Flag, X } from '@docket/ui/icons';
import { Button, DecorativeIcon } from '@docket/ui/primitives';
import type { QueryKey } from '@tanstack/react-query';
import { type JSX, useMemo, useState } from 'react';

import { EntityIconGlyph } from '@/components/entity-display/entity-icon-glyph';
import type { MilestoneTask } from '@/components/project-detail/milestone-tasks';
import { ExcerptMarkdown } from '@/components/mentions/excerpt-markdown';
import { MilestoneSheet } from '@/components/project-detail/milestone-sheet';
import { QuickAddRow } from '@/components/views/quick-add-row';
import { api } from '@/lib/api';
import { formatCalendarDate } from '@/lib/format-date';
import { useCategoryOf } from '@/components/entity-display/use-work-status';
import { countTasksByMilestone } from '@/lib/milestone-progress';
import { milestoneTargetDate } from '@/lib/use-milestone-detail';
import { useProjectMilestones } from '@/lib/use-project-milestones';
import { apiQueryOptions, queryKeys, useApiListQuery } from '@/lib/query';

/** The synthesized bucket id for tasks with no milestone (mirrors the Tasks tab). */
const UNSCHEDULED_KEY = '__unscheduled__';

/** A milestone nothing points at yet. */
const zeroProgress = { done: 0, total: 0 } as const;

/** Props for the private {@link MilestoneGlyph}. */
interface MilestoneGlyphProps {
  /** The milestone's saved icon/color, or `undefined` before the display list resolves. */
  display: EntityDisplayOut | undefined;
  /** The milestone id, which seeds the default glyph when nothing is saved. */
  id: string;
}

/** One milestone's leading glyph at row scale — read-only; the picker lives on the detail page. */
function MilestoneGlyph({ display, id }: MilestoneGlyphProps): JSX.Element {
  const resolved = display ?? defaultEntityDisplay('milestone', id);
  return (
    <EntityIconGlyph
      subjectType="milestone"
      glyph={resolved.glyph}
      colorKey={resolved.colorKey}
      customColor={resolved.customColor}
      size={20}
    />
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
  const [openId, setOpenId] = useState<string | null>(null);
  const { create, remove, pending, mutationError } = useProjectMilestones(
    orgId,
    projectId,
    projectDetailKey,
  );

  const categoryOf = useCategoryOf('task');
  const displaysQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.entityDisplays(orgId, 'milestone'),
      () =>
        api.v1.orgs[':orgId'].display[':subjectType'].$get({
          param: { orgId, subjectType: 'milestone' },
        }),
      'Could not load milestone icons.',
    ),
  );
  const progressByMilestone = useMemo(
    () => countTasksByMilestone(milestoneTasks, UNSCHEDULED_KEY, categoryOf),
    [milestoneTasks, categoryOf],
  );

  const ordered = useMemo(() => [...milestones].sort((a, b) => a.sort - b.sort), [milestones]);
  const nextSort = useMemo(
    () => ordered.reduce((highest, milestone) => Math.max(highest, milestone.sort), -1) + 1,
    [ordered],
  );
  const displayById = useMemo(
    () => new Map((displaysQ.data?.items ?? []).map((display) => [display.subjectId, display])),
    [displaysQ.data?.items],
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
        <EntityList aria-label="Milestones">
          {ordered.map((milestone) => {
            const progress = progressByMilestone.get(milestone.id) ?? zeroProgress;
            const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
            const targetDate = milestoneTargetDate(milestone);
            return (
              <EntityListRow
                key={milestone.id}
                // Inert row carrying its own controls, not a single activatable row: the remove
                // button lives in `trailing`, and `EntityListRow` renders trailing *inside* the one
                // `<button>`/`<a>` it would otherwise create. Nesting a control in a control is
                // invalid markup that destroys keyboard semantics — see `day-highlight-row.tsx`,
                // which documents the same constraint for the same reason.
                interactive={false}
                aria-label={milestone.name}
                leading={
                  <MilestoneGlyph display={displayById.get(milestone.id)} id={milestone.id} />
                }
                title={
                  <button
                    type="button"
                    className="hover:text-primary block min-w-0 truncate text-left"
                    onClick={() => {
                      setOpenId(milestone.id);
                    }}
                  >
                    {milestone.name}
                  </button>
                }
                subtitle={
                  milestone.description === null ? null : (
                    // The note is Markdown source, authored by the detail page's document editor.
                    // Printed raw it reads as `**Feature freeze**`, asterisks and all.
                    <ExcerptMarkdown value={milestone.description} className="truncate" />
                  )
                }
                meta={
                  <>
                    {targetDate === null ? null : (
                      <RowMeta tabular>{formatCalendarDate(targetDate)}</RowMeta>
                    )}
                    {progress.total === 0 ? null : (
                      <RowMeta tabular>
                        <RowProgress
                          value={pct}
                          label={`${milestone.name} task completion`}
                          fillClassName="bg-state-completed"
                        />
                        {progress.done}/{progress.total}
                      </RowMeta>
                    )}
                  </>
                }
                revealTrailingOnHover
                trailing={
                  canEdit ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${milestone.name}`}
                      disabled={pending}
                      onClick={() => {
                        remove(milestone.id);
                      }}
                    >
                      <X className="size-4" />
                    </Button>
                  ) : null
                }
              />
            );
          })}
        </EntityList>
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

      <MilestoneSheet
        orgId={orgId}
        projectId={projectId}
        milestone={ordered.find((entry) => entry.id === openId) ?? null}
        progress={progressByMilestone.get(openId ?? '') ?? zeroProgress}
        taskNoun={taskNoun}
        canEdit={canEdit}
        onClose={() => {
          setOpenId(null);
        }}
      />
    </section>
  );
}
