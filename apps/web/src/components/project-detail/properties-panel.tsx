'use client';

/** Progressive Project property controls used inside the anchored information disclosure. */
import type { Health, LabelOut, ProjectStatus } from '@docket/types';
import {
  DateRangePicker,
  EntityMultiPicker,
  EntityPicker,
  EnumPicker,
  type PickerOption,
} from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Activity, FolderKanban, LayoutGrid, RefreshCw, Tag, Target } from '@docket/ui/icons';
import type { JSX } from 'react';

import { HEALTH_OPTIONS } from '@/components/pickers/options';
import { PropertyPanel, PropertyPanelRow } from '@/components/property-pickers/property-panel';
import { projectStatusOptions } from '@/components/property-pickers/options';
import { formatCalendarDate } from '@/lib/format-date';

/** Props for {@link PropertiesPanel}. */
export interface PropertiesPanelProps {
  health: Health | null;
  status: ProjectStatus;
  startDate: string | null;
  targetDate: string | null;
  programId: string | null;
  programOptions: readonly PickerOption[];
  initiativeIds: readonly string[];
  initiativeOptions: readonly PickerOption[];
  labels: readonly LabelOut[];
  availableLabels: readonly LabelOut[];
  canEdit: boolean;
  pending: boolean;
  onHealthChange: (health: Health | null) => void;
  onStatusChange: (status: ProjectStatus) => void;
  onTimelineChange: (range: { start: string | null; end: string | null }) => void;
  onProgramChange: (programId: string | null) => void;
  onInitiativesChange: (initiativeIds: readonly string[]) => void;
  onLabelsChange: (labelIds: readonly string[]) => void;
}

/** Render secondary Project metadata without promoting every field into the page header. */
export function PropertiesPanel({
  health,
  status,
  startDate,
  targetDate,
  programId,
  programOptions,
  initiativeIds,
  initiativeOptions,
  labels,
  availableLabels,
  canEdit,
  pending,
  onHealthChange,
  onStatusChange,
  onTimelineChange,
  onProgramChange,
  onInitiativesChange,
  onLabelsChange,
}: PropertiesPanelProps): JSX.Element {
  const programLabel = useVocabulary('program');
  const initiativeLabel = useVocabulary('initiative');
  const readOnly = !canEdit;

  return (
    <PropertyPanel className="border-0 bg-transparent px-0 py-0">
      <PropertyPanelRow icon={<Target className="size-4" />} label="Health">
        <EnumPicker<Health>
          options={HEALTH_OPTIONS}
          value={health}
          onChange={onHealthChange}
          placeholder="Set health"
          clearLabel="No health"
          ariaLabel="Health"
          readOnly={readOnly}
          disabled={pending}
        />
      </PropertyPanelRow>
      <PropertyPanelRow divided icon={<Activity className="size-4" />} label="Status">
        <EnumPicker<ProjectStatus>
          options={projectStatusOptions()}
          value={status}
          onChange={(next) => {
            if (next) onStatusChange(next);
          }}
          placeholder="Set status"
          ariaLabel="Status"
          readOnly={readOnly}
          disabled={pending}
        />
      </PropertyPanelRow>
      <PropertyPanelRow divided icon={<RefreshCw className="size-4" />} label="Timeline">
        <DateRangePicker
          value={{ start: startDate, end: targetDate }}
          onChange={onTimelineChange}
          placeholder="Set timeline"
          formatLabel={(value) => formatCalendarDate(value) ?? undefined}
          ariaLabel="Timeline"
          startLabel="Start"
          endLabel="Target"
          readOnly={readOnly}
          disabled={pending}
        />
      </PropertyPanelRow>
      <PropertyPanelRow divided icon={<FolderKanban className="size-4" />} label={programLabel}>
        <EntityPicker
          options={programOptions}
          value={programId}
          onChange={onProgramChange}
          placeholder={`Set ${programLabel.toLowerCase()}`}
          clearLabel={`No ${programLabel.toLowerCase()}`}
          searchPlaceholder={`Search ${programLabel.toLowerCase()}s…`}
          ariaLabel={programLabel}
          readOnly={readOnly}
          disabled={pending}
        />
      </PropertyPanelRow>
      <PropertyPanelRow
        divided
        icon={<LayoutGrid className="size-4" />}
        label={`${initiativeLabel}s`}
      >
        <EntityMultiPicker
          options={initiativeOptions}
          value={initiativeIds}
          onToggle={(initiativeId) => {
            const next = initiativeIds.includes(initiativeId)
              ? initiativeIds.filter((id) => id !== initiativeId)
              : [...initiativeIds, initiativeId];
            onInitiativesChange(next);
          }}
          placeholder={`Add ${initiativeLabel.toLowerCase()}s`}
          singularLabel={initiativeLabel.toLowerCase()}
          pluralLabel={`${initiativeLabel.toLowerCase()}s`}
          searchPlaceholder={`Search ${initiativeLabel.toLowerCase()}s…`}
          emptyText={`No ${initiativeLabel.toLowerCase()}s`}
          ariaLabel={`${initiativeLabel}s`}
          readOnly={readOnly}
          disabled={pending}
        />
      </PropertyPanelRow>
      <PropertyPanelRow divided icon={<Tag className="size-4" />} label="Labels">
        <div className="flex flex-wrap justify-end gap-1">
          {(readOnly ? labels : availableLabels).map((label) => {
            const selected = labels.some((item) => item.id === label.id);
            if (readOnly) {
              return (
                <span
                  key={label.id}
                  className="bg-secondary-container text-on-secondary-container flex min-h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium"
                >
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                  {label.name}
                </span>
              );
            }
            return (
              <button
                key={label.id}
                type="button"
                disabled={pending}
                aria-pressed={selected}
                onClick={() => {
                  onLabelsChange(
                    selected
                      ? labels.filter((item) => item.id !== label.id).map((item) => item.id)
                      : [...labels.map((item) => item.id), label.id],
                  );
                }}
                className={`flex min-h-10 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors ${
                  selected
                    ? 'bg-secondary-container text-on-secondary-container'
                    : 'text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                {label.name}
              </button>
            );
          })}
          {(readOnly ? labels : availableLabels).length === 0 ? (
            <span className="text-on-surface-variant text-xs">
              {readOnly ? '—' : 'No labels yet'}
            </span>
          ) : null}
        </div>
      </PropertyPanelRow>
    </PropertyPanel>
  );
}
