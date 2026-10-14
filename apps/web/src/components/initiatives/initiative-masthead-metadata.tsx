'use client';

/**
 * The Initiative masthead's property row and the load failures it has to own.
 *
 * @remarks
 * Every control here writes one field of the Initiative document, and each of the three pickers
 * reads a roster that can fail on its own — so the row and the banner under it belong together,
 * and neither belongs in the route. The route keeps the reads and hands this component their
 * resolved state.
 */
import type { InitiativeDetail } from '@docket/work/initiative-contract';
import type { LabelOut } from '@docket/work/label-contract';
import type { PickerOption } from '@docket/ui/components';
import { CornerDownLeft } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { CreatedOriginChip } from '@/components/provenance/created-origin';
import { HeaderLoadFailureBanner } from '@/components/entity-detail/header-load-failure';
import { InitiativePropertiesPanel } from '@/components/initiatives/properties-panel';
import {
  ENTITY_METADATA_CHIP_CLASS,
  EntityMetadataItem,
  EntityMetadataRow,
} from '@/components/views/entity-detail-layout';
import type { FiscalYearStartMonthState } from '@/lib/use-fiscal-year-start-month';
import type { InitiativePatch } from '@/lib/use-initiative-mutations';

/** One picker's roster state: whether it is open, loading, or failed, and how to retry. */
export interface MastheadPickerState {
  readonly pickerOpen: boolean;
  readonly onPickerOpenChange: (open: boolean) => void;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly onRetry: () => void;
}

/** The owner picker's roster. */
export interface MastheadOwnerState extends MastheadPickerState {
  readonly options: readonly PickerOption[];
}

/** The labels picker's rosters and its create path. */
export interface MastheadLabelsState extends MastheadPickerState {
  readonly assigned: readonly LabelOut[];
  readonly available: readonly LabelOut[];
  /** Whether the assigned set has resolved; creating a label appends to it, so it must be known. */
  readonly canCreate: boolean;
  readonly onCreate: (name: string) => void;
  readonly onChange: (labelIds: readonly string[]) => void;
}

/** Props for {@link InitiativeMastheadMetadata}. */
export interface InitiativeMastheadMetadataProps {
  readonly initiativeNoun: string;
  readonly detail: InitiativeDetail;
  readonly canEdit: boolean;
  readonly patch: (patch: InitiativePatch) => void;
  readonly planningCalendar: FiscalYearStartMonthState;
  readonly owner: MastheadOwnerState;
  readonly labels: MastheadLabelsState;
  /** The target-date picker only needs open/closed; its roster is the planning calendar. */
  readonly targetPickerOpen: boolean;
  readonly onTargetPickerOpenChange: (open: boolean) => void;
  /** Whether the display (icon and color) read failed. */
  readonly displayFailed: boolean;
  /** Open the hierarchy picker anchored to the control that asked for it. */
  readonly onManageHierarchy: (anchor: HTMLElement) => void;
}

/**
 * The roster reads whose failure the masthead reports, in the order they are shown.
 *
 * @remarks
 * A picker's roster only matters once someone opens that picker, which is why each entry is
 * already gated on `pickerOpen` by the time it arrives here. The planning calendar is the one
 * exception: its own control stays disabled rather than empty, so the gate is the target picker.
 *
 * @param props - The same state the row is rendered from.
 * @returns the failure entries for {@link HeaderLoadFailureBanner}.
 */
function mastheadFailures({
  planningCalendar,
  owner,
  labels,
  targetPickerOpen,
  displayFailed,
}: InitiativeMastheadMetadataProps) {
  return [
    {
      failed: targetPickerOpen && planningCalendar.error !== null,
      title: 'Could not load planning calendar settings',
      onRetry: planningCalendar.retry,
    },
    { failed: owner.failed, title: 'Could not load members', onRetry: owner.onRetry },
    { failed: labels.failed, title: 'Could not load labels', onRetry: labels.onRetry },
    { failed: displayFailed, title: 'Could not load display settings' },
  ];
}

/** The Initiative masthead property row with its own failure reporting. */
export function InitiativeMastheadMetadata(props: InitiativeMastheadMetadataProps): JSX.Element {
  const {
    initiativeNoun,
    detail,
    canEdit,
    patch,
    planningCalendar,
    owner,
    labels,
    onTargetPickerOpenChange,
    onManageHierarchy,
  } = props;

  return (
    <div className="no-print flex flex-col gap-2">
      <EntityMetadataRow ariaLabel={`${initiativeNoun} properties`}>
        <InitiativePropertiesPanel
          status={detail.status}
          health={detail.health ?? null}
          targetDate={detail.targetDate ?? null}
          targetDateResolution={detail.targetDateResolution}
          targetDateFiscalYearStartMonth={detail.targetDateFiscalYearStartMonth}
          fiscalYearStartMonth={planningCalendar.fiscalYearStartMonth}
          planningCalendarLoading={planningCalendar.loading}
          ownerId={detail.ownerId ?? null}
          priority={detail.priority}
          updateCadence={detail.updateCadence}
          memberOptions={owner.options}
          ownerLoading={owner.loading}
          onOwnerPickerOpenChange={owner.onPickerOpenChange}
          labels={labels.assigned}
          availableLabels={labels.available}
          labelsLoading={labels.loading}
          onLabelsPickerOpenChange={labels.onPickerOpenChange}
          onTargetPickerOpenChange={onTargetPickerOpenChange}
          canEdit={canEdit}
          onStatusChange={(status) => {
            patch({ status });
          }}
          onHealthChange={(health) => {
            patch({ health });
          }}
          onTargetChange={(target) => {
            patch({
              targetDate: target?.date ?? null,
              targetDateResolution: target?.resolution ?? null,
            });
          }}
          onOwnerChange={(ownerId) => {
            patch({ ownerId });
          }}
          onPriorityChange={(priority) => {
            patch({ priority });
          }}
          onCadenceChange={(updateCadence) => {
            patch({ updateCadence });
          }}
          onLabelsChange={labels.onChange}
          {...(labels.canCreate ? { onCreateLabel: labels.onCreate } : {})}
        />
        <EntityMetadataItem priority={7} overflowOnly>
          <Button
            variant="ghost"
            className={ENTITY_METADATA_CHIP_CLASS}
            onClick={(event) => {
              onManageHierarchy(event.currentTarget);
            }}
          >
            <CornerDownLeft aria-hidden className="size-5" />
            Manage hierarchy
          </Button>
        </EntityMetadataItem>
        <CreatedOriginChip createdAt={detail.createdAt} />
      </EntityMetadataRow>
      <HeaderLoadFailureBanner failures={mastheadFailures(props)} />
    </div>
  );
}
