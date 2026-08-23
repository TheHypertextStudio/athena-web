'use client';

import { Card, Checkbox } from '@docket/ui/primitives';
import type { ViewTarget } from '@docket/work/view-contract';
import { type JSX } from 'react';

import type { WorkViewDefinitionFor } from './view-state';
import { workViewDisplayFieldCatalog } from './view-state';
import {
  formatWorkViewValue,
  type WorkViewRowFor,
  workViewRowTitle,
  workViewRowValue,
} from './renderer-types';

/** Props for the renderer-independent card presentation of a work collection. */
export interface WorkCardsProps<TTarget extends ViewTarget> {
  readonly target: TTarget;
  readonly definition: WorkViewDefinitionFor<TTarget>;
  readonly rows: readonly WorkViewRowFor<TTarget>[];
  readonly selectedIds: ReadonlySet<string>;
  readonly onSelectionChange: (ids: ReadonlySet<string>) => void;
  readonly onActivate: (row: WorkViewRowFor<TTarget>) => void;
}

/** Render any target-backed collection as a responsive card grid without target-specific cards. */
export function WorkCards<TTarget extends ViewTarget>({
  target,
  definition,
  rows,
  selectedIds,
  onSelectionChange,
  onActivate,
}: WorkCardsProps<TTarget>): JSX.Element {
  const properties = workViewDisplayFieldCatalog(target).filter((field) =>
    definition.presentation.properties.includes(field.key),
  );
  const toggle = (id: string): void => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  return (
    <div
      role="list"
      aria-label={`${target.charAt(0).toUpperCase()}${target.slice(1)} cards`}
      className="grid min-h-0 grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3 overflow-auto p-1"
    >
      {rows.map((row) => (
        <Card
          key={row.id}
          role="listitem"
          tabIndex={0}
          className="focus-visible:ring-primary min-h-36 cursor-pointer p-4 outline-none focus-visible:ring-2"
          onClick={() => {
            onActivate(row);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onActivate(row);
            }
          }}
        >
          <div className="flex items-start gap-3">
            <Checkbox
              aria-label={`Select ${workViewRowTitle(row)}`}
              checked={selectedIds.has(row.id)}
              onClick={(event) => {
                event.stopPropagation();
              }}
              onChange={() => {
                toggle(row.id);
              }}
            />
            <div className="min-w-0 flex-1">
              <h2 className="text-title-medium truncate">{workViewRowTitle(row)}</h2>
              {properties.length > 0 ? (
                <dl className="text-on-surface-variant text-body-small mt-3 grid gap-1">
                  {properties.map((field) => (
                    <div key={field.key} className="flex min-w-0 gap-2">
                      <dt className="shrink-0">{field.label}</dt>
                      <dd className="truncate">
                        {formatWorkViewValue(workViewRowValue(row, field.key))}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
