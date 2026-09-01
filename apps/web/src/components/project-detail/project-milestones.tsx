'use client';

/**
 * The project Overview's Milestones section — create, rename, describe, target-date, and
 * remove a project's milestones in place.
 *
 * @remarks
 * Milestones previously had no management surface anywhere in the product: the API and
 * schema existed, but a milestone could only be *seen* (as a grouping header in the Tasks
 * tab) never created or edited. This panel is that missing surface, styled to match the
 * other Overview-tab cards ({@link "@/components/project-detail/project-dependencies"}).
 * Name and description autosave through {@link EditableTitle}/{@link EditableFreeformText}
 * the same way every other Docket field does now — no explicit Save button, no separate
 * edit-mode toggle. Removing a milestone has no confirm dialog, matching the API's own
 * framing of deletion as lightweight (a milestone's tasks just lose the reference, they
 * aren't touched) and the dependency panel's precedent.
 */
import {
  defaultEntityDisplay,
  type EntityDisplayColorKey,
  type EntityDisplayIconKey,
  type EntityDisplayOut,
} from '@docket/work/entity-display-contract';
import { type MilestoneOut } from '@docket/work/milestone-contract';
import { DatePicker } from '@docket/ui/components';
import { Flag, Plus, X } from '@docket/ui/icons';
import { Button, DecorativeIcon, Textarea } from '@docket/ui/primitives';
import type { QueryKey } from '@tanstack/react-query';
import { type JSX, useMemo, useState } from 'react';

import { EditableFreeformText } from '@/components/editor/freeform-text';
import { EditableTitle } from '@/components/editor/editable-title';
import { EntityIconPicker } from '@/components/entity-display/entity-icon-picker';
import type { MilestoneTask } from '@/components/project-detail/milestone-tasks';
import { api } from '@/lib/api';
import { formatCalendarDate } from '@/lib/format-date';
import { useCategoryOf } from '@/components/entity-display/use-work-status';
import { countTasksByMilestone } from '@/lib/milestone-progress';
import { useProjectMilestones } from '@/lib/use-project-milestones';
import { apiQueryOptions, queryKeys, unwrap, useApiListQuery, useApiMutation } from '@/lib/query';

/** The synthesized bucket id for tasks with no milestone (mirrors the Tasks tab). */
const UNSCHEDULED_KEY = '__unscheduled__';

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
  /** Whether the viewer may create/edit/delete milestones. */
  canEdit: boolean;
  /** A milestone id to scroll to and highlight on mount (deep link from search). */
  highlightId?: string | null;
}

/** The Overview-tab Milestones card: list, inline-edit, quick-add, and remove. */
export function ProjectMilestonesPanel({
  orgId,
  projectId,
  projectDetailKey,
  milestones,
  milestoneTasks,
  canEdit,
  highlightId,
}: ProjectMilestonesPanelProps): JSX.Element {
  const { create, update, remove, pending, mutationError } = useProjectMilestones(
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
  const updateDisplay = useApiMutation<
    EntityDisplayOut,
    {
      readonly id: string;
      readonly iconKey: EntityDisplayIconKey;
      readonly colorKey: EntityDisplayColorKey;
      readonly customColor: string | null;
    }
  >({
    mutationFn: ({ id, ...json }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].display[':subjectType'][':subjectId'].$put({
            param: { orgId, subjectType: 'milestone', subjectId: id },
            json,
          }),
        'Could not customize this milestone.',
      ),
    invalidateKeys: [queryKeys.entityDisplays(orgId, 'milestone')],
  });
  const progressByMilestone = useMemo(
    () => countTasksByMilestone(milestoneTasks, UNSCHEDULED_KEY, categoryOf),
    [milestoneTasks, categoryOf],
  );

  const ordered = useMemo(() => [...milestones].sort((a, b) => a.sort - b.sort), [milestones]);
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
        <ul className="flex flex-col gap-3">
          {ordered.map((milestone) => {
            const progress = progressByMilestone.get(milestone.id) ?? { done: 0, total: 0 };
            const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
            const highlighted = highlightId === milestone.id;
            return (
              <li
                key={milestone.id}
                id={`milestone-${milestone.id}`}
                data-highlighted={highlighted ? 'true' : undefined}
                className="border-outline-variant data-[highlighted=true]:ring-primary flex flex-col gap-2 rounded-lg border p-3 transition-shadow data-[highlighted=true]:ring-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <EntityIconPicker
                      display={
                        displayById.get(milestone.id) ??
                        defaultEntityDisplay('milestone', milestone.id)
                      }
                      entityName={milestone.name}
                      editable={canEdit}
                      pending={updateDisplay.isPending}
                      loading={displaysQ.isPending}
                      size={32}
                      onChange={(iconKey, colorKey, customColor) => {
                        updateDisplay.mutate({
                          id: milestone.id,
                          iconKey,
                          colorKey,
                          customColor,
                        });
                      }}
                    />
                    <EditableTitle
                      value={milestone.name}
                      onSave={(name) => {
                        update(milestone.id, { name });
                      }}
                      canEdit={canEdit}
                      ariaLabel="Milestone name"
                      className="text-on-surface text-title-small"
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <DatePicker
                      value={milestone.targetDate ? milestone.targetDate.slice(0, 10) : null}
                      onChange={(targetDate) => {
                        update(milestone.id, { targetDate });
                      }}
                      placeholder="Set target date"
                      formatLabel={(value) => formatCalendarDate(value) ?? undefined}
                      ariaLabel="Milestone target date"
                      readOnly={!canEdit}
                      disabled={pending}
                      triggerVariant="ghost"
                    />
                    {canEdit ? (
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
                        <X className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>

                <EditableFreeformText
                  value={milestone.description}
                  placeholder="Add a note…"
                  canEdit={canEdit}
                  onSave={(description) => {
                    update(milestone.id, { description });
                  }}
                  className="text-on-surface-variant text-body-medium"
                />

                {progress.total > 0 ? (
                  <div className="flex items-center gap-2">
                    <div
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${milestone.name}: ${pct}% complete`}
                      className="bg-surface-container h-1.5 flex-1 overflow-hidden rounded-full"
                    >
                      <div
                        className="bg-state-completed h-full rounded-full transition-[width] duration-500 ease-out"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-on-surface-variant text-label-small shrink-0 tabular-nums">
                      {progress.done}/{progress.total}
                    </span>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {canEdit ? (
        <QuickAddMilestoneRow
          onAdd={(input) => {
            create({ ...input, sort: ordered.length });
          }}
          disabled={pending}
        />
      ) : null}

      {mutationError ? (
        <p role="alert" className="text-error text-body-medium">
          {mutationError}
        </p>
      ) : null}
    </section>
  );
}

/** The fields a quick-add submits in one create call. */
export interface QuickAddMilestoneInput {
  name: string;
  description?: string;
  targetDate?: string;
}

/** Props for the private {@link QuickAddMilestoneRow}. */
interface QuickAddMilestoneRowProps {
  onAdd: (input: QuickAddMilestoneInput) => void;
  disabled: boolean;
}

/**
 * Inline milestone composer — still "type a name, press Enter" for speed, but typing a name
 * progressively reveals a description field and a target date so all three can go in with the
 * same create call instead of a name-only row edited again immediately after.
 */
function QuickAddMilestoneRow({ onAdd, disabled }: QuickAddMilestoneRowProps): JSX.Element {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetDate, setTargetDate] = useState<string | null>(null);
  const expanded = name.trim().length > 0;

  const add = (): void => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    onAdd({
      name: trimmed,
      ...(description.trim().length > 0 ? { description: description.trim() } : {}),
      ...(targetDate ? { targetDate } : {}),
    });
    setName('');
    setDescription('');
    setTargetDate(null);
  };

  return (
    <form
      className="border-outline-variant focus-within:border-primary flex flex-col gap-2 rounded-lg border border-dashed px-3 py-2 transition-colors"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <div className="flex items-center gap-2">
        <Plus aria-hidden className="text-on-surface-variant size-4 shrink-0" />
        <input
          value={name}
          disabled={disabled}
          aria-label="New milestone name"
          placeholder="Add a milestone…"
          onChange={(event) => {
            setName(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              add();
            }
          }}
          className="text-body-medium text-on-surface placeholder:text-on-surface-variant h-9 flex-1 bg-transparent outline-none"
        />
        {expanded ? (
          <DatePicker
            value={targetDate}
            onChange={setTargetDate}
            placeholder="Target date"
            formatLabel={(value) => formatCalendarDate(value) ?? undefined}
            ariaLabel="Milestone target date"
            disabled={disabled}
            triggerVariant="ghost"
          />
        ) : null}
      </div>
      {expanded ? (
        <>
          <Textarea
            value={description}
            disabled={disabled}
            aria-label="New milestone description"
            placeholder="Add a note…"
            rows={2}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            disabled={disabled}
            className="self-end"
          >
            Add milestone
          </Button>
        </>
      ) : null}
    </form>
  );
}
