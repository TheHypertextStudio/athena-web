'use client';

/**
 * Right-rail properties panel for the task detail view.
 *
 * @remarks
 * **Structure comes from spacing, alignment, and type — never from rules.** There is no divider
 * anywhere in this panel: no `divide-y`, no `border-t`/`border-l`, no `<hr>`, at any breakpoint.
 * Three mechanisms carry the structure instead, and each is a single decision applied everywhere:
 *
 * 1. **Grouping by spacing.** The rows are gathered into semantic groups — *Placement* (where this
 *    task sits in the work hierarchy), *Schedule* (when it happens), and, only for an imported
 *    task, *Origin*. Rows inside a group are flush (`gap-0` — each row owns its own `h-9`), and
 *    groups are separated by `gap-6`. Larger-between-than-within is the whole grouping signal, and
 *    both values are standard spacing-scale steps (`0` and `1.5rem`); no ad hoc pixel value
 *    appears in this file. The groups carry `role="group"` + an `aria-label` rather than a visible
 *    heading, so the structure is announced to a screen reader without adding a second type style
 *    to the panel.
 * 2. **One grid.** Every row is a {@link PropertyRow}: a `w-28` label gutter and a flexible value
 *    slot at a fixed `h-9`. Labels therefore share one left x, values share one left x, and every
 *    row measures the same — including rows whose value is a picker button rather than text.
 * 3. **One type token.** `text-body-medium` is set once, on the `aside`, and inherited by
 *    everything. The picker triggers are forced onto it too via {@link PROPERTY_CONTROL_CLASS},
 *    because {@link PropertyTrigger} builds a `Button size="sm"` whose `text-xs` would otherwise
 *    render "Set project" two pixels smaller than the "Aug 1, 2026" two rows below it. Static
 *    values render through {@link PropertyText}, which reproduces the trigger's box (`h-9 px-2`)
 *    so a set value and an unset one occupy the same space. The panel heading is `sr-only` — a
 *    labelled region needs a name, not a second font size.
 *
 * All field pickers call back to the parent page via {@link TaskPropertiesRailProps.onPatch};
 * read-only state and pending state are controlled by the parent so the rail has no mutation state
 * of its own.
 */
import type { EstimationScale, TaskDetail } from '@docket/types';
import { DatePicker, EntityPicker, LabelsPicker, type PickerOption } from '@docket/ui/components';
import { Flag, FolderKanban, Layers, RefreshCw, Tag } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import type { JSX, ReactNode } from 'react';

import { formatCalendarDate } from '@/lib/format-date';
import type { TaskPatch } from '@/lib/use-task-mutations';
import { EstimatePicker } from './EstimatePicker';
import { PropertyRow } from './PropertyRow';

/**
 * The one class every property *control* carries.
 *
 * @remarks
 * Defined once and reused on every trigger so the panel cannot drift back into a mix of sizes.
 * `h-9` matches {@link PropertyRow}'s row height (so a control never makes its row taller than a
 * text row), and `text-body-medium` overrides the `text-xs` that `Button size="sm"` contributes —
 * `cn` knows Docket's MD3 scale as font sizes, so the later token wins cleanly rather than both
 * classes surviving.
 */
const PROPERTY_CONTROL_CLASS = 'h-9 text-body-medium';

/**
 * A static (non-interactive) property value, boxed exactly like a picker trigger.
 *
 * @remarks
 * The `h-9 px-2` reproduces the trigger's box so a row reading "Aug 1, 2026" and a row reading
 * "Set project" have their text starting on the same x and their boxes occupying the same band.
 * Without it, static values sat 8px to the left of every control in the same column.
 */
function PropertyText({
  children,
  muted = false,
}: {
  readonly children: ReactNode;
  readonly muted?: boolean;
}): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex h-9 min-w-0 items-center px-2',
        muted ? 'text-on-surface-variant' : 'text-on-surface',
      )}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Format a date for a static property value, or an em-dash when it is absent. */
function formatDate(value: string | null | undefined): string {
  return formatCalendarDate(value) ?? '—';
}

/** Narrow an ISO timestamp or date to the bare `YYYY-MM-DD` the date fields and API exchange. */
function isoDateOf(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

/**
 * Name the place an imported task came from.
 *
 * @remarks
 * The rail has no integration directory to turn a `sourceIntegrationId` into "GitHub", and
 * fetching one just to label a link would make this panel do a network read. The external URL is
 * already in hand and already names the origin in words a reader recognizes, so the host is the
 * label: *Imported from → github.com*. An unparseable URL falls back to an instruction rather than
 * a guess.
 */
function originLabel(externalUrl: string): string {
  try {
    return new URL(externalUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'Open the original';
  }
}

/** Props for {@link TaskPropertiesRail}. */
export interface TaskPropertiesRailProps {
  task: TaskDetail;
  projectLabel: string;
  programLabel: string;
  cycleLabel: string;
  projectOptions: readonly PickerOption[];
  programOptions: readonly PickerOption[];
  milestoneOptions: readonly PickerOption[];
  cycleOptions: readonly PickerOption[];
  /** Every label offerable to this task, each carrying its colour swatch as its `icon`. */
  labelOptions: readonly PickerOption[];
  projectLoading?: boolean | undefined;
  programLoading?: boolean | undefined;
  milestoneLoading?: boolean | undefined;
  cycleLoading?: boolean | undefined;
  labelsLoading?: boolean | undefined;
  onProjectOpenChange?: ((open: boolean) => void) | undefined;
  onProgramOpenChange?: ((open: boolean) => void) | undefined;
  onMilestoneOpenChange?: ((open: boolean) => void) | undefined;
  onCycleOpenChange?: ((open: boolean) => void) | undefined;
  onLabelsOpenChange?: ((open: boolean) => void) | undefined;
  /** Create a label from a name typed into the picker, and attach it. */
  onCreateLabel: (name: string) => void;
  /**
   * The workspace's configured estimation scale, or `null` while it loads.
   *
   * @remarks
   * The Estimate row renders only once this resolves to a scale other than `'none'` — a
   * workspace that has turned estimation off gets no row at all, and a still-loading scale gets
   * no picker offering the wrong (or zero) choices rather than a flash of one.
   */
  estimationScale: EstimationScale | null;
  canEdit: boolean;
  onPatch: (patch: TaskPatch) => void;
}

/**
 * Task properties sidebar — placement, schedule, and (for imported work only) origin.
 *
 * @param props - See {@link TaskPropertiesRailProps}.
 */
export function TaskPropertiesRail({
  task,
  projectLabel,
  programLabel,
  cycleLabel,
  projectOptions,
  programOptions,
  milestoneOptions,
  cycleOptions,
  labelOptions,
  projectLoading = false,
  programLoading = false,
  milestoneLoading = false,
  cycleLoading = false,
  labelsLoading = false,
  onProjectOpenChange,
  onProgramOpenChange,
  onMilestoneOpenChange,
  onCycleOpenChange,
  onLabelsOpenChange,
  onCreateLabel,
  estimationScale,
  canEdit,
  onPatch,
}: TaskPropertiesRailProps): JSX.Element {
  const provenance = task.provenance;

  return (
    <div aria-labelledby="properties-heading" className="text-body-medium flex flex-col gap-6">
      <h2 id="properties-heading" className="sr-only">
        Properties
      </h2>

      {/* Placement — where this task sits in the workspace's hierarchy of work. */}
      <div role="group" aria-label="Placement" className="flex flex-col">
        <PropertyRow label={projectLabel}>
          <EntityPicker
            options={projectOptions}
            value={task.projectId ?? null}
            onChange={(projectId) => {
              onPatch({ projectId });
            }}
            placeholder={`Set ${projectLabel.toLowerCase()}`}
            triggerIcon={<FolderKanban className="text-on-surface-variant size-4" />}
            clearLabel={`No ${projectLabel.toLowerCase()}`}
            searchPlaceholder={`Search ${projectLabel.toLowerCase()}s…`}
            ariaLabel={projectLabel}
            readOnly={!canEdit}
            loading={projectLoading}
            {...(onProjectOpenChange ? { onOpenChange: onProjectOpenChange } : {})}
            triggerClassName={PROPERTY_CONTROL_CLASS}
          />
        </PropertyRow>

        <PropertyRow label={programLabel}>
          <EntityPicker
            options={programOptions}
            value={task.programId ?? null}
            onChange={(programId) => {
              onPatch({ programId });
            }}
            placeholder={`Set ${programLabel.toLowerCase()}`}
            triggerIcon={<Layers className="text-on-surface-variant size-4" />}
            clearLabel={`No ${programLabel.toLowerCase()}`}
            searchPlaceholder={`Search ${programLabel.toLowerCase()}s…`}
            ariaLabel={programLabel}
            readOnly={!canEdit}
            loading={programLoading}
            {...(onProgramOpenChange ? { onOpenChange: onProgramOpenChange } : {})}
            triggerClassName={PROPERTY_CONTROL_CLASS}
          />
        </PropertyRow>

        <PropertyRow label="Milestone">
          <EntityPicker
            options={milestoneOptions}
            value={task.milestoneId ?? null}
            onChange={(milestoneId) => {
              onPatch({ milestoneId });
            }}
            placeholder={
              task.projectId ? 'Set milestone' : `Set a ${projectLabel.toLowerCase()} first`
            }
            triggerIcon={<Flag className="text-on-surface-variant size-4" />}
            clearLabel="No milestone"
            searchPlaceholder="Search milestones…"
            emptyText={
              task.projectId
                ? 'No milestones'
                : `Set a ${projectLabel.toLowerCase()} to choose a milestone`
            }
            ariaLabel="Milestone"
            readOnly={!canEdit || !task.projectId}
            loading={milestoneLoading}
            {...(onMilestoneOpenChange ? { onOpenChange: onMilestoneOpenChange } : {})}
            triggerClassName={PROPERTY_CONTROL_CLASS}
          />
        </PropertyRow>

        <PropertyRow label={cycleLabel}>
          <EntityPicker
            options={cycleOptions}
            value={task.cycleId ?? null}
            onChange={(cycleId) => {
              onPatch({ cycleId });
            }}
            placeholder={`Set ${cycleLabel.toLowerCase()}`}
            triggerIcon={<RefreshCw className="text-on-surface-variant size-4" />}
            clearLabel={`No ${cycleLabel.toLowerCase()}`}
            searchPlaceholder={`Search ${cycleLabel.toLowerCase()}s…`}
            ariaLabel={cycleLabel}
            readOnly={!canEdit}
            loading={cycleLoading}
            {...(onCycleOpenChange ? { onOpenChange: onCycleOpenChange } : {})}
            triggerClassName={PROPERTY_CONTROL_CLASS}
          />
        </PropertyRow>
      </div>

      {/* Labels — the workspace's own vocabulary, the one dimension Docket does not define. */}
      <div role="group" aria-label="Labels" className="flex flex-col">
        <PropertyRow label="Labels">
          <LabelsPicker
            options={labelOptions}
            value={task.labels.map((l) => l.id)}
            onToggle={(labelId) => {
              const next = task.labels.some((l) => l.id === labelId)
                ? task.labels.filter((l) => l.id !== labelId).map((l) => l.id)
                : [...task.labels.map((l) => l.id), labelId];
              onPatch({ labels: next });
            }}
            onCreate={onCreateLabel}
            placeholder="Add labels"
            triggerIcon={<Tag className="text-on-surface-variant size-4" />}
            ariaLabel="Labels"
            readOnly={!canEdit}
            loading={labelsLoading}
            {...(onLabelsOpenChange ? { onOpenChange: onLabelsOpenChange } : {})}
            triggerClassName={PROPERTY_CONTROL_CLASS}
          />
        </PropertyRow>
      </div>

      {/* Schedule — when the work is expected to begin, when it is due, how big it is, and when it
          entered the system. Anticipated start and Due live in the same group on purpose: they are
          the two ends of one span, and reading them in one place is what makes a task schedulable
          rather than merely deadlined. */}
      <div role="group" aria-label="Schedule" className="flex flex-col">
        <PropertyRow label="Anticipated start">
          <DatePicker
            value={isoDateOf(task.startDate)}
            onChange={(startDate) => {
              onPatch({ startDate });
            }}
            placeholder="Set anticipated start"
            formatLabel={(value) => formatCalendarDate(value) ?? undefined}
            ariaLabel="Anticipated start"
            readOnly={!canEdit}
            triggerClassName={PROPERTY_CONTROL_CLASS}
          />
        </PropertyRow>

        <PropertyRow label="Due">
          <DatePicker
            value={isoDateOf(task.dueDate)}
            onChange={(dueDate) => {
              onPatch({ dueDate });
            }}
            placeholder="Set due date"
            formatLabel={(value) => formatCalendarDate(value) ?? undefined}
            ariaLabel="Due"
            readOnly={!canEdit}
            triggerClassName={PROPERTY_CONTROL_CLASS}
          />
        </PropertyRow>

        {estimationScale && estimationScale !== 'none' ? (
          <PropertyRow label="Estimate">
            <EstimatePicker
              scale={estimationScale}
              value={task.estimate ?? null}
              onChange={(estimate) => {
                onPatch({ estimate });
              }}
              readOnly={!canEdit}
              triggerClassName={PROPERTY_CONTROL_CLASS}
            />
          </PropertyRow>
        ) : null}

        <PropertyRow label="Created">
          <PropertyText muted>{formatDate(task.createdAt)}</PropertyText>
        </PropertyRow>
      </div>

      {/*
        Origin — rendered ONLY for a task that came from somewhere else. A task created in Docket
        has no origin worth naming: the old panel spent a row saying "Source: Native", a word that
        described the implementation rather than anything the reader could act on. The row is now
        the answer to a question a reader would actually ask — "where was this imported from?" —
        and it simply does not exist when the answer is "nowhere".
      */}
      {provenance.source === 'linked' ? (
        <div role="group" aria-label="Origin" className="flex flex-col">
          <PropertyRow label="Imported from">
            {provenance.externalUrl ? (
              <a
                href={provenance.externalUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary focus-visible:ring-ring inline-flex h-9 min-w-0 items-center rounded px-2 underline-offset-4 hover:underline focus-visible:ring-1 focus-visible:outline-none"
              >
                <span className="truncate">{originLabel(provenance.externalUrl)}</span>
              </a>
            ) : (
              <PropertyText muted>An external tool</PropertyText>
            )}
          </PropertyRow>
        </div>
      ) : null}
    </div>
  );
}
