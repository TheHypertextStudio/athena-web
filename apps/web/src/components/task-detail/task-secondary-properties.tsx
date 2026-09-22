'use client';

/**
 * The task's secondary properties: estimate, labels, cycle, milestone, program, anticipated start,
 * delegate, created, and (for imported work) origin.
 *
 * @remarks
 * Each field is exported so the properties sidebar (`task-properties-panel.tsx`) renders it as a
 * row, and {@link TaskSecondaryProperties} renders the same fields as chips in the masthead row
 * when the pane is too narrow for the sidebar. Each chip carries a priority so it demotes into the
 * row's overflow popover as the pane narrows. The page mounts exactly one of the two, so a property
 * never exists twice on screen.
 *
 * Every picker reports through the model's `onPatch`; read-only and loading state are controlled
 * by the parent, so this component holds no mutation state.
 */
import type { EstimationScale } from '../../lib/contracts/organization';
import type { TaskDetail } from '@docket/work/task-model';
import {
  ActorAvatar,
  type ActorKind,
  DatePicker,
  EntityPicker,
  LabelsPicker,
  type PickerOption,
} from '@docket/ui/components';
import { Flag, Layers, Schedule, Tag } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import type { JSX } from 'react';

import {
  ENTITY_METADATA_CHIP_CLASS,
  EntityMetadataItem,
  EntityMetadataStaticChip,
} from '@/components/views/entity-detail-layout';
import { formatCalendarDate, isoDateOf } from '@/lib/format-date';
import type { TaskPatch } from '@/lib/use-task-mutations';
import { FutureCyclePicker } from '@/components/pickers/future-cycle-picker';
import { EstimatePicker } from './EstimatePicker';

/** The actor a task hands its work to, resolved for display. */
export interface TaskDelegate {
  readonly name: string;
  readonly kind: ActorKind;
  readonly avatarUrl?: string | null | undefined;
}

/** The properties only the secondary set reads; the shared ones stay on the property model. */
export interface TaskSecondaryModel {
  programLabel: string;
  cycleLabel: string;
  programOptions: readonly PickerOption[];
  milestoneOptions: readonly PickerOption[];
  /** Every label offerable to this task, each carrying its colour swatch as its `icon`. */
  labelOptions: readonly PickerOption[];
  programLoading?: boolean | undefined;
  milestoneLoading?: boolean | undefined;
  onProgramOpenChange?: ((open: boolean) => void) | undefined;
  onMilestoneOpenChange?: ((open: boolean) => void) | undefined;
  /** Create a label from a name typed into the picker, and attach it. */
  onCreateLabel: (name: string) => void;
  /**
   * The workspace's configured estimation scale, or `null` while it loads.
   *
   * @remarks
   * The estimate appears only once this resolves to a scale other than `'none'`: a workspace that
   * has turned estimation off gets no estimate at all, and a still-loading scale offers no picker
   * rather than a flash of the wrong choices.
   */
  estimationScale: EstimationScale | null;
  /** Who the work is delegated to, when someone. */
  delegate?: TaskDelegate | null | undefined;
}

/** The slice of the page's property model the secondary set renders from. */
export interface TaskSecondaryHostModel {
  readonly task: TaskDetail;
  readonly canEdit: boolean;
  readonly onPatch: (patch: TaskPatch) => void;
  readonly projectLabel: string;
  readonly secondary: TaskSecondaryModel;
}

/** What the chip presentation renders from. */
interface SecondaryProps {
  readonly model: TaskSecondaryHostModel;
}

/** What one field renders from: the shared model plus the trigger class its presentation wants. */
export interface FieldProps {
  readonly model: TaskSecondaryHostModel;
  readonly triggerClassName: string;
}

/**
 * Name the place an imported task came from.
 *
 * @remarks
 * There is no integration directory to turn a `sourceIntegrationId` into "GitHub", and fetching
 * one just to label a link would make this panel do a network read. The external URL is already
 * in hand and already names the origin in words a reader recognizes, so the host is the label.
 * An unparseable URL falls back to an instruction rather than a guess.
 */
function originLabel(externalUrl: string): string {
  try {
    return new URL(externalUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'Open the original';
  }
}

/**
 * Whether the estimate has a scale to offer choices from.
 *
 * @param scale - The workspace's estimation scale, or `null` while it loads.
 * @returns `true` when the estimate field should render.
 */
export function hasEstimate(
  scale: EstimationScale | null,
): scale is Exclude<EstimationScale, 'none'> {
  return scale !== null && scale !== 'none';
}

/** The program the task counts toward. */
export function ProgramField({ model, triggerClassName }: FieldProps): JSX.Element {
  const { task, canEdit, onPatch, secondary } = model;
  const { programLabel, programOptions, programLoading, onProgramOpenChange } = secondary;
  const noun = programLabel.toLowerCase();
  return (
    <EntityPicker
      options={programOptions}
      value={task.programId ?? null}
      onChange={(programId) => {
        onPatch({ programId });
      }}
      placeholder={`Set ${noun}`}
      triggerIcon={<Layers className="text-on-surface-variant size-4" />}
      clearLabel={`No ${noun}`}
      searchPlaceholder={`Search ${noun}s…`}
      ariaLabel={programLabel}
      readOnly={!canEdit}
      loading={programLoading ?? false}
      {...(onProgramOpenChange ? { onOpenChange: onProgramOpenChange } : {})}
      triggerClassName={triggerClassName}
    />
  );
}

/** The milestone of the task's project it targets. */
export function MilestoneField({ model, triggerClassName }: FieldProps): JSX.Element {
  const { task, canEdit, onPatch, projectLabel, secondary } = model;
  const { milestoneOptions, milestoneLoading, onMilestoneOpenChange } = secondary;
  const noun = projectLabel.toLowerCase();
  return (
    <EntityPicker
      options={milestoneOptions}
      value={task.milestoneId ?? null}
      onChange={(milestoneId) => {
        onPatch({ milestoneId });
      }}
      placeholder={task.projectId ? 'Set milestone' : `Set a ${noun} first`}
      triggerIcon={<Flag className="text-on-surface-variant size-4" />}
      clearLabel="No milestone"
      searchPlaceholder="Search milestones…"
      emptyText={task.projectId ? 'No milestones' : `Set a ${noun} to choose a milestone`}
      ariaLabel="Milestone"
      readOnly={!canEdit || !task.projectId}
      loading={milestoneLoading ?? false}
      {...(onMilestoneOpenChange ? { onOpenChange: onMilestoneOpenChange } : {})}
      triggerClassName={triggerClassName}
    />
  );
}

/** The cycle the task is committed to. */
export function CycleField({ model, triggerClassName }: FieldProps): JSX.Element {
  const { task, canEdit, onPatch, secondary } = model;
  const { cycleLabel } = secondary;
  const noun = cycleLabel.toLowerCase();
  return (
    <FutureCyclePicker
      orgId={task.organizationId}
      teamId={task.teamId}
      value={task.cycleId ?? null}
      onChange={(cycleId, cycleCadenceRevision) => {
        onPatch({ cycleId, cycleCadenceRevision });
      }}
      placeholder={`Set ${noun}`}
      noun={cycleLabel}
      readOnly={!canEdit}
      triggerClassName={triggerClassName}
    />
  );
}

/** The task's labels. */
export function LabelsField({ model, triggerClassName }: FieldProps): JSX.Element {
  const { task, canEdit, onPatch, secondary } = model;
  const labelIds: readonly string[] = task.labels.map((label) => label.id);
  return (
    <LabelsPicker
      options={secondary.labelOptions}
      value={labelIds}
      onToggle={(labelId) => {
        onPatch({
          labels: labelIds.includes(labelId)
            ? labelIds.filter((id) => id !== labelId)
            : [...labelIds, labelId],
        });
      }}
      onCreate={secondary.onCreateLabel}
      placeholder="Add labels"
      triggerIcon={<Tag className="text-on-surface-variant size-4" />}
      ariaLabel="Labels"
      readOnly={!canEdit}
      triggerClassName={triggerClassName}
    />
  );
}

/** When work on the task is expected to begin. */
export function StartField({ model, triggerClassName }: FieldProps): JSX.Element {
  return (
    <DatePicker
      value={isoDateOf(model.task.startDate)}
      onChange={(startDate) => {
        model.onPatch({ startDate });
      }}
      placeholder="Set anticipated start"
      formatLabel={(value) => formatCalendarDate(value) ?? undefined}
      ariaLabel="Anticipated start"
      readOnly={!model.canEdit}
      triggerClassName={triggerClassName}
    />
  );
}

/** The task's estimate, on the workspace's scale; nothing when estimation is off. */
export function EstimateField({ model, triggerClassName }: FieldProps): JSX.Element | null {
  const { task, canEdit, onPatch, secondary } = model;
  const { estimationScale } = secondary;
  if (!hasEstimate(estimationScale)) return null;
  return (
    <EstimatePicker
      scale={estimationScale}
      value={task.estimate ?? null}
      onChange={(estimate) => {
        onPatch({ estimate });
      }}
      readOnly={!canEdit}
      triggerClassName={triggerClassName}
    />
  );
}

/** The origin of imported work: a link to the original when there is one. */
export function OriginLink({
  externalUrl,
  className,
}: {
  readonly externalUrl: string;
  readonly className: string;
}): JSX.Element {
  return (
    <a
      href={externalUrl}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'text-primary focus-visible:ring-ring inline-flex min-w-0 items-center rounded-md px-2 underline-offset-4 hover:underline focus-visible:ring-1 focus-visible:outline-none',
        className,
      )}
    >
      <span className="truncate">{originLabel(externalUrl)}</span>
    </a>
  );
}

/** Delegate, created and origin as read-only chips at the end of the metadata row's overflow. */
function ReadOnlyChips({ model }: SecondaryProps): JSX.Element {
  const { task, secondary } = model;
  const { delegate } = secondary;
  const provenance = task.provenance;
  return (
    <>
      {delegate ? (
        <EntityMetadataItem priority={7} overflowOnly>
          <EntityMetadataStaticChip
            icon={
              <ActorAvatar
                kind={delegate.kind}
                name={delegate.name}
                avatarUrl={delegate.avatarUrl}
              />
            }
            label={`Delegate ${delegate.name}`}
            ariaLabel="Delegate"
          />
        </EntityMetadataItem>
      ) : null}
      <EntityMetadataItem priority={7} overflowOnly>
        <EntityMetadataStaticChip
          icon={<Schedule className="size-4" />}
          label={`Created ${formatCalendarDate(task.createdAt) ?? '—'}`}
          ariaLabel="Task"
        />
      </EntityMetadataItem>
      {provenance.source === 'linked' && provenance.externalUrl ? (
        <EntityMetadataItem priority={7} overflowOnly>
          <OriginLink
            externalUrl={provenance.externalUrl}
            className={cn(ENTITY_METADATA_CHIP_CLASS, 'py-1.5')}
          />
        </EntityMetadataItem>
      ) : null}
    </>
  );
}

/**
 * The task properties that follow the masthead's lead set, as prioritized chips that demote into
 * the row's overflow.
 *
 * @param props - The page's property model.
 * @returns the chips, for an `EntityMetadataRow`.
 */
export function TaskSecondaryProperties({ model }: SecondaryProps): JSX.Element {
  const field: FieldProps = { model, triggerClassName: ENTITY_METADATA_CHIP_CLASS };
  return (
    <>
      {hasEstimate(model.secondary.estimationScale) ? (
        <EntityMetadataItem priority={4}>
          <EstimateField {...field} />
        </EntityMetadataItem>
      ) : null}
      <EntityMetadataItem priority={5}>
        <LabelsField {...field} />
      </EntityMetadataItem>
      <EntityMetadataItem priority={6}>
        <CycleField {...field} />
      </EntityMetadataItem>
      <EntityMetadataItem priority={7} overflowOnly>
        <MilestoneField {...field} />
      </EntityMetadataItem>
      <EntityMetadataItem priority={7} overflowOnly>
        <ProgramField {...field} />
      </EntityMetadataItem>
      <EntityMetadataItem priority={7} overflowOnly>
        <StartField {...field} />
      </EntityMetadataItem>
      <ReadOnlyChips model={model} />
    </>
  );
}
