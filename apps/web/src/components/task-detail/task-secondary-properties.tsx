'use client';

/**
 * The task's secondary properties: everything the masthead row does not lead with.
 *
 * @remarks
 * The primary properties (status, priority, assignee, project, due date) live in the masthead's
 * metadata row. What remains — estimate, labels, cycle, milestone, program, anticipated start,
 * delegate, created, and (for imported work) origin — is presented one of two ways, decided by
 * the page from how much room the pane has:
 *
 * - `chips`: more items in the metadata row, each with its own priority so they demote into the
 *   row's overflow popover as the pane narrows.
 * - `rows`: labelled rows docked beside the body (`EntityDetailLayout`'s aside slot), so the
 *   properties stay in view while the document scrolls.
 *
 * Both presentations render the same fields from the same props, so a property never exists twice
 * on screen: the page mounts exactly one of them.
 *
 * **Structure in `rows` comes from spacing, alignment, and type.** Rows inside a group are flush
 * (each owns its `h-9`), groups are separated by `gap-6`, every label shares one gutter and every
 * value one left edge, and `text-body-medium` is set once on the panel and forced onto each
 * trigger through {@link ROW_CONTROL_CLASS}. Groups carry `role="group"` and an `aria-label`
 * instead of a visible heading, so the structure is announced without a second type style.
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
import type { JSX, ReactNode } from 'react';

import {
  ENTITY_METADATA_CHIP_CLASS,
  EntityMetadataItem,
  EntityMetadataStaticChip,
} from '@/components/views/entity-detail-layout';
import { formatCalendarDate, isoDateOf } from '@/lib/format-date';
import type { TaskPatch } from '@/lib/use-task-mutations';
import { FutureCyclePicker } from '@/components/pickers/future-cycle-picker';
import { EstimatePicker } from './EstimatePicker';
import { PropertyRow } from './PropertyRow';

/**
 * The class every property control carries in the `rows` presentation.
 *
 * @remarks
 * `h-9` matches {@link PropertyRow}'s row height, so a control never makes its row taller than a
 * text row, and `text-body-medium` overrides the `text-xs` that `Button size="sm"` contributes.
 */
const ROW_CONTROL_CLASS = 'h-9 text-body-medium';

/** The actor a task hands its work to, resolved for display. */
export interface TaskDelegate {
  readonly name: string;
  readonly kind: ActorKind;
  readonly avatarUrl?: string | null | undefined;
}

/** How the secondary properties are laid out. */
export type TaskSecondaryPresentation = 'rows' | 'chips';

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

/** Props for {@link TaskSecondaryProperties}. */
export interface TaskSecondaryPropertiesProps {
  /** `chips` for the metadata row, `rows` for the docked aside. */
  presentation: TaskSecondaryPresentation;
  model: TaskSecondaryHostModel;
}

/** What a presentation renders from. */
interface SecondaryProps {
  readonly model: TaskSecondaryHostModel;
}

/** What one field renders from: the shared model plus the trigger class its presentation wants. */
interface FieldProps {
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

/** Whether the estimate has a scale to offer choices from. */
function hasEstimate(scale: EstimationScale | null): scale is Exclude<EstimationScale, 'none'> {
  return scale !== null && scale !== 'none';
}

function ProgramField({ model, triggerClassName }: FieldProps): JSX.Element {
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

function MilestoneField({ model, triggerClassName }: FieldProps): JSX.Element {
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

function CycleField({ model, triggerClassName }: FieldProps): JSX.Element {
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

function LabelsField({ model, triggerClassName }: FieldProps): JSX.Element {
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

function StartField({ model, triggerClassName }: FieldProps): JSX.Element {
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

function EstimateField({ model, triggerClassName }: FieldProps): JSX.Element | null {
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

/** A static value in the `rows` presentation, boxed exactly like a picker trigger. */
function RowText({
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

/** The origin of imported work: a link to the original when there is one. */
function OriginLink({
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

/** The docked presentation: labelled rows in spacing-separated groups. */
function SecondaryRows({ model }: SecondaryProps): JSX.Element {
  const { task, secondary } = model;
  const { programLabel, cycleLabel, delegate } = secondary;
  const field: FieldProps = { model, triggerClassName: ROW_CONTROL_CLASS };
  const provenance = task.provenance;
  return (
    <div aria-labelledby="properties-heading" className="text-body-medium flex flex-col gap-6">
      <h2 id="properties-heading" className="sr-only">
        Properties
      </h2>

      <div role="group" aria-label="Placement" className="flex flex-col">
        <PropertyRow label={programLabel}>
          <ProgramField {...field} />
        </PropertyRow>
        <PropertyRow label="Milestone">
          <MilestoneField {...field} />
        </PropertyRow>
        <PropertyRow label={cycleLabel}>
          <CycleField {...field} />
        </PropertyRow>
        {delegate ? (
          <PropertyRow label="Delegate">
            <RowText>{delegate.name}</RowText>
          </PropertyRow>
        ) : null}
      </div>

      <div role="group" aria-label="Labels" className="flex flex-col">
        <PropertyRow label="Labels">
          <LabelsField {...field} />
        </PropertyRow>
      </div>

      <div role="group" aria-label="Schedule" className="flex flex-col">
        <PropertyRow label="Anticipated start">
          <StartField {...field} />
        </PropertyRow>
        {hasEstimate(secondary.estimationScale) ? (
          <PropertyRow label="Estimate">
            <EstimateField {...field} />
          </PropertyRow>
        ) : null}
        <PropertyRow label="Created">
          <RowText muted>{formatCalendarDate(task.createdAt) ?? '—'}</RowText>
        </PropertyRow>
      </div>

      {provenance.source === 'linked' ? (
        <div role="group" aria-label="Origin" className="flex flex-col">
          <PropertyRow label="Imported from">
            {provenance.externalUrl ? (
              <OriginLink externalUrl={provenance.externalUrl} className="h-9" />
            ) : (
              <RowText muted>An external tool</RowText>
            )}
          </PropertyRow>
        </div>
      ) : null}
    </div>
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

/** The metadata-row presentation: prioritized chips that demote into the row's overflow. */
function SecondaryChips({ model }: SecondaryProps): JSX.Element {
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

/**
 * The task properties that follow the masthead's lead set.
 *
 * @param props - See {@link TaskSecondaryPropertiesProps}.
 * @returns the chips (for an `EntityMetadataRow`) or the labelled rows (for the aside).
 */
export function TaskSecondaryProperties({
  presentation,
  model,
}: TaskSecondaryPropertiesProps): JSX.Element {
  return presentation === 'rows' ? (
    <SecondaryRows model={model} />
  ) : (
    <SecondaryChips model={model} />
  );
}
