'use client';

import type { AccountExportOptionsOut } from '@docket/identity-access/account-contract';
import { Button, Checkbox, FieldError, Surface } from '@docket/ui/primitives';
import { SettingsGroup } from './settings-group';
import { SETTINGS_NODES } from './settings-capabilities';
import { type JSX, useId, useState } from 'react';

import {
  EXPORT_CATEGORY_COPY,
  type ExportCategory,
  type ExportRequestInput,
} from './export-data-model';

/** Props for the selective archive request form. */
export interface ExportRequestFormProps {
  /** The current delivery address and selectable workspaces. */
  readonly options: AccountExportOptionsOut;
  /** Whether the account already has an export being prepared. */
  readonly hasPendingExport: boolean;
  /** Whether the create request is in flight. */
  readonly creating: boolean;
  /** Queue an archive with the reviewed selection. */
  readonly onCreate: (input: ExportRequestInput) => void;
}

/** Props for {@link WorkspaceChoices}. */
interface WorkspaceChoicesProps {
  /** The workspaces this account can export. */
  readonly workspaces: AccountExportOptionsOut['workspaces'];
  /** The ids of the workspaces currently selected. */
  readonly selectedIds: readonly string[];
  /** Replace the selection. */
  readonly onChange: (ids: readonly string[]) => void;
}

/**
 * The workspace checkbox group, with the line that says why an empty selection cannot be exported.
 *
 * @remarks
 * A checkbox group is a control `Field` cannot wrap, so the group's `fieldset` carries the wiring a
 * single control would: it names the `FieldError` line and reports itself invalid.
 */
function WorkspaceChoices({
  workspaces,
  selectedIds,
  onChange,
}: WorkspaceChoicesProps): JSX.Element {
  const errorId = useId();
  const missing = selectedIds.length === 0;

  function toggle(workspaceId: string, checked: boolean): void {
    onChange(
      checked ? [...selectedIds, workspaceId] : selectedIds.filter((id) => id !== workspaceId),
    );
  }

  return (
    <fieldset
      className="flex flex-col gap-3"
      aria-describedby={missing ? errorId : undefined}
      aria-invalid={missing || undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <legend className="text-on-surface text-label-large">Workspaces</legend>
        <button
          type="button"
          className="text-primary focus-visible:ring-ring text-label-large coarse:min-h-10 inline-flex items-center rounded hover:underline focus-visible:ring-2"
          onClick={() => {
            onChange(workspaces.map((workspace) => workspace.id));
          }}
        >
          Select all
        </button>
      </div>
      <p className="text-on-surface-variant text-body-medium">
        Select the workspaces whose Docket work you want in this export.
      </p>
      <Surface as="div" tone="card" shape="large" pad="none" className="flex flex-col">
        {workspaces.map((workspace) => {
          const inputId = `export-workspace-${workspace.id}`;
          return (
            <label
              key={workspace.id}
              htmlFor={inputId}
              className="hover:bg-surface-container-low coarse:min-h-10 flex cursor-pointer items-center gap-3 px-3 py-2"
            >
              <Checkbox
                id={inputId}
                checked={selectedIds.includes(workspace.id)}
                className="shrink-0 rounded"
                onChange={(event) => {
                  toggle(workspace.id, event.target.checked);
                }}
              />
              <span className="text-on-surface text-body-medium break-words">{workspace.name}</span>
            </label>
          );
        })}
      </Surface>
      {missing ? (
        <FieldError id={errorId}>
          Select at least one workspace or remove Workspace data from this export.
        </FieldError>
      ) : null}
    </fieldset>
  );
}

/** Select account categories and workspaces, review delivery, then request the archive. */
export function ExportRequestForm({
  options,
  hasPendingExport,
  creating,
  onCreate,
}: ExportRequestFormProps): JSX.Element {
  const [categories, setCategories] = useState<readonly ExportCategory[]>(() => [
    'account',
    'personal',
    ...(options.workspaces.length > 0 ? (['workspaces'] as const) : []),
  ]);
  const [workspaceIds, setWorkspaceIds] = useState<readonly string[]>(() =>
    options.workspaces.map((workspace) => workspace.id),
  );

  const includesWorkspaces = categories.includes('workspaces');
  const canRequest =
    !hasPendingExport &&
    categories.length > 0 &&
    (!includesWorkspaces || workspaceIds.length > 0) &&
    !creating;
  const selectedWorkspaceNames = options.workspaces
    .filter((workspace) => workspaceIds.includes(workspace.id))
    .map((workspace) => workspace.name);

  function toggleCategory(category: ExportCategory, checked: boolean): void {
    setCategories((previous) =>
      checked ? [...previous, category] : previous.filter((selected) => selected !== category),
    );
    if (category === 'workspaces') {
      setWorkspaceIds(checked ? options.workspaces.map((workspace) => workspace.id) : []);
    }
  }

  return (
    <>
      <SettingsGroup capability={SETTINGS_NODES.dataExportSelection}>
        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">Data categories</legend>
          {(Object.keys(EXPORT_CATEGORY_COPY) as ExportCategory[]).map((category) => {
            const copy = EXPORT_CATEGORY_COPY[category];
            const inputId = `export-category-${category}`;
            return (
              <Surface
                as="label"
                key={category}
                htmlFor={inputId}
                tone="canvas"
                shape="large"
                pad="comfortable"
                className="hover:bg-surface-container-high flex cursor-pointer gap-3"
              >
                <Checkbox
                  id={inputId}
                  checked={categories.includes(category)}
                  className="mt-0.5 shrink-0 rounded"
                  onChange={(event) => {
                    toggleCategory(category, event.target.checked);
                  }}
                />
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-on-surface text-label-large">{copy.title}</span>
                  <span className="text-on-surface-variant text-body-medium">
                    {copy.description}
                  </span>
                </span>
              </Surface>
            );
          })}
        </fieldset>

        {includesWorkspaces ? (
          <WorkspaceChoices
            workspaces={options.workspaces}
            selectedIds={workspaceIds}
            onChange={setWorkspaceIds}
          />
        ) : null}
      </SettingsGroup>

      <SettingsGroup capability={SETTINGS_NODES.dataExportReview}>
        <p className="text-on-surface-variant text-body-medium">
          Your export will be a ZIP file. Docket will email you at{' '}
          <span className="text-on-surface text-label-large">{options.deliveryEmail}</span> when
          your data is ready. Your download stays available for 14 days.
        </p>
        <p className="text-on-surface-variant text-body-medium">
          Includes:{' '}
          <span className="text-on-surface">
            {categories.map((category) => EXPORT_CATEGORY_COPY[category].title).join(', ')}
            {includesWorkspaces && selectedWorkspaceNames.length > 0
              ? ` (${selectedWorkspaceNames.join(', ')})`
              : ''}
          </span>
        </p>
        {hasPendingExport ? (
          <p role="status" aria-live="polite" className="text-on-surface-variant text-body-medium">
            An export is already being prepared. You can leave this page and download it here when
            it is ready.
          </p>
        ) : null}
        <div>
          <Button
            type="button"
            disabled={!canRequest}
            onClick={() => {
              onCreate({
                categories,
                workspaceIds: includesWorkspaces ? workspaceIds : [],
              });
            }}
          >
            {creating ? 'Creating export…' : 'Create export'}
          </Button>
        </div>
      </SettingsGroup>
    </>
  );
}
