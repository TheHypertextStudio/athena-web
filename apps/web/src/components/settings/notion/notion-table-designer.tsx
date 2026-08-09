'use client';

/**
 * `settings/notion` — the table designer.
 *
 * @remarks
 * Shows what the Notion database will actually look like, rendered as a Notion-style table and
 * filled with the workspace's **real** rows, and lets the user shape it: rename the database,
 * rename or remove columns, and choose how a person is represented.
 *
 * Two decisions carry most of the surface's weight.
 *
 * The Docket field key sits under every column header in mono. Once titles are user-chosen, the
 * binding between "the column called DRI" and `task.assignee` is otherwise invisible, and a user
 * who cannot see it cannot reason about what a rename will do.
 *
 * Sample rows are labelled loudly. A designer that quietly shows invented data teaches the reader
 * to distrust every number on the page, so an empty workspace says so rather than looking full.
 *
 * Pure presentation — reads and writes live in `use-notion-mirror-controller.ts`.
 */
import type { NotionMirrorDesignOut, NotionPersonRepresentation } from '@docket/types';
import { cn } from '@docket/ui';
import { Plus, X } from '@docket/ui/icons';
import { Input, Select, Skeleton } from '@docket/ui/primitives';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';

import {
  REPRESENTATION_CHOICES,
  SAMPLE_ROWS_NOTE,
  directionNote,
  excludedRowsNote,
} from './notion-copy';
import { type DesignerColumn, useNotionTableDesign } from './use-notion-mirror-controller';
import type { NotionMirrorEntity } from '@docket/types';

/** Props for {@link NotionTableDesigner}. */
export interface NotionTableDesignerProps {
  orgId: string;
  integrationId: string;
  entity: NotionMirrorEntity;
}

/** Read the designer's editable column list out of a loaded design. */
function columnsOf(design: NotionMirrorDesignOut): DesignerColumn[] {
  // Sorted, never trusted in object order: `property_map` arrives from a jsonb column, and
  // PostgreSQL normalizes its keys by length then bytes — so `Object.values` yields the columns
  // rearranged, which is exactly how "Status" ended up left of "Name".
  return [...Object.values(design.database.propertyMap)]
    .sort((a, b) => a.order - b.order)
    .map((binding) => ({
      field: binding.field,
      title: binding.title,
      ...(binding.representation !== undefined ? { representation: binding.representation } : {}),
      ...(binding.relationDataSourceId !== undefined
        ? { relationDataSourceId: binding.relationDataSourceId }
        : {}),
    }));
}

/** The table designer for one entity. */
export function NotionTableDesigner({
  orgId,
  integrationId,
  entity,
}: NotionTableDesignerProps): JSX.Element {
  const model = useNotionTableDesign(orgId, integrationId, entity);
  const design = model.design;

  const [title, setTitle] = useState('');
  const [columns, setColumns] = useState<DesignerColumn[]>([]);
  const [openColumn, setOpenColumn] = useState<string | null>(null);
  const [seededFrom, setSeededFrom] = useState<string | null>(null);

  // Seed local edit state from the server the first time a design arrives, and again when the
  // server's own version changes (a save landing, or another tab). Adjusted during render rather
  // than in an effect — React's own recommendation for "state derived from props" — so the first
  // paint already has the right values instead of flashing empty and then filling in.
  //
  // The key is the design's identity plus its schema version, NOT the object: a background
  // refetch that returns an equivalent design must not clobber what the user is typing.
  const seedKey =
    design === null
      ? null
      : `${design.database.id}:${String(Object.keys(design.database.propertyMap).length)}:${design.database.title}`;
  if (design !== null && seedKey !== seededFrom) {
    setSeededFrom(seedKey);
    setTitle(design.database.title);
    setColumns(columnsOf(design));
  }

  const fieldsByKey = useMemo(
    () => new Map((design?.availableFields ?? []).map((f) => [f.field, f])),
    [design],
  );
  const unusedFields = useMemo(
    () => (design?.availableFields ?? []).filter((f) => !columns.some((c) => c.field === f.field)),
    [design, columns],
  );

  if (model.loading) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        {/* placeholder: the designed columns and a page of the workspace's own rows, both of
            which only the server can supply. */}
        <Skeleton className="h-8 w-48 rounded-lg" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (design === null) {
    return (
      <p role="alert" className="text-error text-body-medium">
        {model.error ?? 'Could not load this table design.'}
      </p>
    );
  }

  const commitColumns = (next: DesignerColumn[]): void => {
    setColumns(next);
    model.saveColumns(next);
  };

  const removeColumn = (field: string): void => {
    commitColumns(columns.filter((c) => c.field !== field));
    setOpenColumn(null);
  };

  const addColumn = (field: string): void => {
    const def = fieldsByKey.get(field);
    if (!def) return;
    commitColumns([
      ...columns,
      {
        field,
        title: def.label,
        ...(def.personValued ? { representation: 'text' as const } : {}),
      },
    ]);
  };

  const renameColumn = (field: string, nextTitle: string): void => {
    setColumns((prev) => prev.map((c) => (c.field === field ? { ...c, title: nextTitle } : c)));
  };

  const setRepresentation = (field: string, representation: NotionPersonRepresentation): void => {
    commitColumns(columns.map((c) => (c.field === field ? { ...c, representation } : c)));
  };

  const open = openColumn === null ? null : columns.find((c) => c.field === openColumn);
  const openField = open ? fieldsByKey.get(open.field) : undefined;

  return (
    <div className="@container flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-on-surface-variant text-body-small">Database name in Notion</span>
          <Input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
            onBlur={() => {
              if (title.trim().length > 0 && title !== design.database.title) {
                model.renameDatabase(title.trim());
              }
            }}
            className="w-64 max-w-full"
          />
        </label>
        <p className="text-on-surface-variant text-body-small" aria-live="polite">
          {model.saving ? 'Saving…' : model.saved ? 'Saved' : null}
        </p>
      </div>

      <p className="text-on-surface-variant text-body-small max-w-prose">
        {directionNote(design.database.direction)}
      </p>

      {/* A wide table must scroll inside its own container; the page itself never scrolls
          sideways. */}
      <div className="border-outline-variant bg-surface-container-low overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[36rem] border-collapse text-left">
          <thead>
            <tr className="bg-surface-container">
              {columns.map((column) => {
                const def = fieldsByKey.get(column.field);
                const isOpen = openColumn === column.field;
                return (
                  <th
                    key={column.field}
                    scope="col"
                    className={cn(
                      'border-outline-variant text-body-medium border-b px-3 py-2 align-top',
                      isOpen && 'bg-primary/5',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setOpenColumn(isOpen ? null : column.field);
                      }}
                      aria-expanded={isOpen}
                      className="flex flex-col items-start gap-0.5 text-left"
                    >
                      <span className="text-on-surface text-body-medium">{column.title}</span>
                      {/* The Docket field this column is bound to. Kept visible because the
                          title is user-chosen and the binding is otherwise invisible. */}
                      <span className="text-on-surface-variant text-label-small font-mono">
                        {entity}.{column.field}
                      </span>
                    </button>
                    {def?.required === false ? (
                      <button
                        type="button"
                        aria-label={`Remove the ${column.title} column`}
                        onClick={() => {
                          removeColumn(column.field);
                        }}
                        className="text-on-surface-variant hover:text-error sr-only focus:not-sr-only"
                      >
                        <X aria-hidden="true" className="size-3.5" />
                      </button>
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {design.rows.map((row, index) => (
              <tr key={index} className="border-outline-variant border-b last:border-b-0">
                {columns.map((column) => (
                  <td
                    key={column.field}
                    className="text-on-surface text-body-medium max-w-[14rem] truncate px-3 py-2"
                  >
                    {row.cells[column.field] ?? <span className="text-on-surface-variant">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-outline-variant flex flex-wrap items-center gap-3 border-t px-3 py-2">
          {unusedFields.length > 0 ? (
            <label className="flex items-center gap-2">
              <span className="text-on-surface-variant text-body-small flex items-center gap-1">
                <Plus aria-hidden="true" className="size-3.5" />
                Add a column
              </span>
              <Select
                value=""
                onChange={(e) => {
                  if (e.target.value) addColumn(e.target.value);
                }}
                aria-label="Add a column from Docket"
                className="text-body-small h-8 w-48"
              >
                <option value="">Choose a field…</option>
                {unusedFields.map((f) => (
                  <option key={f.field} value={f.field}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          <span className="text-on-surface-variant text-body-small">
            {columns.length} of {design.availableFields.length} Docket fields shown
          </span>
        </div>
      </div>

      {design.sample ? (
        <p className="text-on-surface-variant text-body-small" role="note">
          {SAMPLE_ROWS_NOTE}
        </p>
      ) : (
        <p className="text-on-surface-variant text-body-small">
          Previewing {design.rows.length} of {design.totalRows.toLocaleString()} rows.
          {design.excludedRows > 0 ? ` ${excludedRowsNote(design.excludedRows)}` : ''}
        </p>
      )}

      {open && openField ? (
        <div className="border-primary/40 bg-surface-container-low flex flex-col gap-3 rounded-xl border p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-on-surface text-label-large">{open.title} column</span>
            <span className="text-on-surface-variant text-label-small font-mono">
              {entity}.{open.field}
            </span>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-on-surface-variant text-body-small">Column title in Notion</span>
            <Input
              value={open.title}
              onChange={(e) => {
                renameColumn(open.field, e.target.value);
              }}
              onBlur={() => {
                // Only when the title actually moved. The database-title field above already
                // guards this way; without it, tabbing through the editor writes on every blur.
                const saved = design.database.propertyMap[open.field]?.title;
                if (open.title.trim().length > 0 && open.title !== saved) commitColumns(columns);
              }}
            />
          </label>

          {openField.personValued ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-on-surface-variant text-body-small mb-1">
                Show the person as
              </legend>
              {REPRESENTATION_CHOICES.map((choice) => (
                <label
                  key={choice.value}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-lg border p-2.5',
                    open.representation === choice.value
                      ? 'border-primary bg-primary/5'
                      : 'border-outline-variant',
                  )}
                >
                  <input
                    type="radio"
                    name={`rep-${open.field}`}
                    className="accent-primary mt-0.5 size-4"
                    checked={open.representation === choice.value}
                    onChange={() => {
                      setRepresentation(open.field, choice.value);
                    }}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-on-surface text-body-medium">{choice.label}</span>
                    <span className="text-on-surface-variant text-body-small">{choice.detail}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}

          {!openField.required ? (
            <button
              type="button"
              onClick={() => {
                removeColumn(open.field);
              }}
              className="text-error text-body-medium w-fit hover:underline"
            >
              Remove this column
            </button>
          ) : (
            <p className="text-on-surface-variant text-body-small">
              Notion needs one title column, so this one can’t be removed.
            </p>
          )}
        </div>
      ) : null}

      {model.error !== null ? (
        <p role="alert" className="text-error text-body-medium">
          {model.error}
        </p>
      ) : null}
    </div>
  );
}
