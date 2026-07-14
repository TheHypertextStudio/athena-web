'use client';

import type { AccountExportOptionsOut } from '@docket/types';
import { Button } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

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
  /** Application-owned mutation error copy, when a request failed. */
  readonly error: string | null;
  /** Queue an archive with the reviewed selection. */
  readonly onCreate: (input: ExportRequestInput) => void;
}

/** Select account categories and workspaces, review delivery, then request the archive. */
export function ExportRequestForm({
  options,
  hasPendingExport,
  creating,
  error,
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

  function toggleWorkspace(workspaceId: string, checked: boolean): void {
    setWorkspaceIds((previous) =>
      checked ? [...previous, workspaceId] : previous.filter((id) => id !== workspaceId),
    );
  }

  return (
    <div className="border-outline-variant flex flex-col gap-6 rounded-lg border p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-on-surface text-h3 font-semibold">Choose data to include</h2>
        <p className="text-on-surface-variant text-body">
          Start with everything selected, then remove anything you do not need.
        </p>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Data categories</legend>
        {(Object.keys(EXPORT_CATEGORY_COPY) as ExportCategory[]).map((category) => {
          const copy = EXPORT_CATEGORY_COPY[category];
          const inputId = `export-category-${category}`;
          return (
            <label
              key={category}
              htmlFor={inputId}
              className="border-outline-variant hover:bg-surface-container-low flex cursor-pointer gap-3 rounded-lg border p-3"
            >
              <input
                id={inputId}
                type="checkbox"
                checked={categories.includes(category)}
                className="accent-primary focus-visible:ring-ring mt-0.5 size-4 shrink-0 rounded focus-visible:ring-2"
                onChange={(event) => {
                  toggleCategory(category, event.target.checked);
                }}
              />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-on-surface text-body font-medium">{copy.title}</span>
                <span className="text-on-surface-variant text-body">{copy.description}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {includesWorkspaces ? (
        <fieldset className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <legend className="text-on-surface text-body font-medium">Workspaces</legend>
            <button
              type="button"
              className="text-primary focus-visible:ring-ring rounded text-sm font-medium hover:underline focus-visible:ring-2"
              onClick={() => {
                setWorkspaceIds(options.workspaces.map((workspace) => workspace.id));
              }}
            >
              Select all
            </button>
          </div>
          <p className="text-on-surface-variant text-body">
            Select the workspaces whose Docket work you want in this export.
          </p>
          <div className="border-outline-variant flex max-h-72 flex-col overflow-y-auto rounded-lg border">
            {options.workspaces.map((workspace) => {
              const inputId = `export-workspace-${workspace.id}`;
              return (
                <label
                  key={workspace.id}
                  htmlFor={inputId}
                  className="border-outline-variant hover:bg-surface-container-low flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-b-0"
                >
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={workspaceIds.includes(workspace.id)}
                    className="accent-primary focus-visible:ring-ring size-4 shrink-0 rounded focus-visible:ring-2"
                    onChange={(event) => {
                      toggleWorkspace(workspace.id, event.target.checked);
                    }}
                  />
                  <span className="text-on-surface text-body break-words">{workspace.name}</span>
                </label>
              );
            })}
          </div>
          {workspaceIds.length === 0 ? (
            <p role="alert" className="text-destructive text-body">
              Select at least one workspace or remove Workspace data from this export.
            </p>
          ) : null}
        </fieldset>
      ) : null}

      <div className="border-outline-variant bg-surface-container-low flex flex-col gap-2 rounded-lg border p-4">
        <h2 className="text-on-surface text-body font-semibold">Review &amp; create</h2>
        <p className="text-on-surface-variant text-body">
          Your export will be a ZIP file. Docket will email you at{' '}
          <span className="text-on-surface font-medium">{options.deliveryEmail}</span> when your
          data is ready. Your download stays available for 14 days.
        </p>
        <p className="text-on-surface-variant text-body">
          Includes:{' '}
          <span className="text-on-surface">
            {categories.map((category) => EXPORT_CATEGORY_COPY[category].title).join(', ')}
            {includesWorkspaces && selectedWorkspaceNames.length > 0
              ? ` (${selectedWorkspaceNames.join(', ')})`
              : ''}
          </span>
        </p>
        {error ? (
          <p role="alert" className="text-destructive text-body">
            {error}
          </p>
        ) : null}
        {hasPendingExport ? (
          <p role="status" aria-live="polite" className="text-on-surface-variant text-body">
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
      </div>
    </div>
  );
}
