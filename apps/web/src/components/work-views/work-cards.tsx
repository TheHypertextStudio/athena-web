'use client';

import { entityNavigationSnapshotFromWorkViewRow } from '@docket/types';
import { Button, Card, Checkbox } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import type { ViewTarget } from '@docket/work/view-contract';
import { type JSX, type ReactNode } from 'react';

import { useRelationDropTarget } from '@/components/dnd/use-relation-drop-target';
import { ObjectSurface } from '@/components/objects/object-surface';

import DocketLink from '@/components/docket-link';
import { buildEntityHref } from '@/lib/authenticated-route';

import type { WorkViewDefinitionFor } from './view-state';
import { workViewDisplayFieldCatalog } from './view-state';
import {
  formatWorkViewValue,
  type WorkViewRowFor,
  workViewRowDisplayValue,
  workViewRowTitle,
} from './renderer-types';
import { objectForWorkViewRow } from './work-view-object';

function WorkObjectCard<TTarget extends ViewTarget>({
  row,
  onActivate,
  children,
}: {
  readonly row: WorkViewRowFor<TTarget>;
  readonly onActivate: () => void;
  readonly children: ReactNode;
}): JSX.Element {
  const object = objectForWorkViewRow(row);
  const drop = useRelationDropTarget({ target: object });
  return (
    <ObjectSurface object={object} surfaceId={`work-cards:${row.target}`} onActivate={onActivate}>
      <Card
        ref={drop.dropProps.ref}
        role="listitem"
        tabIndex={0}
        data-drop-state={drop.dropState}
        className={cn(
          'group/card focus-visible:ring-primary relative min-h-36 cursor-pointer p-4 outline-none focus-visible:ring-2',
          drop.dropProps.className,
          drop.dropState === 'accept' && 'ring-primary bg-primary/8 ring-2',
          drop.dropState === 'reject' && 'ring-error/60 bg-error/5 ring-1',
        )}
      >
        {children}
        {drop.effectLabel ? (
          <span className="bg-primary-container text-on-primary-container text-label-small absolute right-3 bottom-3 rounded-md px-2 py-1">
            {drop.effectLabel}
          </span>
        ) : null}
      </Card>
    </ObjectSurface>
  );
}

/** Props for the renderer-independent card presentation of a work collection. */
export interface WorkCardsProps<TTarget extends ViewTarget> {
  readonly target: TTarget;
  readonly definition: WorkViewDefinitionFor<TTarget>;
  readonly rows: readonly WorkViewRowFor<TTarget>[];
  readonly selectedIds: ReadonlySet<string>;
  readonly onSelectionChange: (ids: ReadonlySet<string>) => void;
  readonly onActivate: (row: WorkViewRowFor<TTarget>) => void;
  readonly hasMoreRows?: boolean;
  readonly loadingMoreRows?: boolean;
  readonly onLoadMoreRows?: (() => void) | undefined;
}

/** Render any target-backed collection as a responsive card grid without target-specific cards. */
export function WorkCards<TTarget extends ViewTarget>({
  target,
  definition,
  rows,
  selectedIds,
  onSelectionChange,
  onActivate,
  hasMoreRows = false,
  loadingMoreRows = false,
  onLoadMoreRows,
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
    <div className="flex h-full min-h-0 flex-col overflow-auto">
      <div
        role="list"
        aria-label={`${target.charAt(0).toUpperCase()}${target.slice(1)} cards`}
        className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3 p-1"
      >
        {rows.map((row) => (
          <WorkObjectCard key={row.id} row={row} onActivate={() => onActivate(row)}>
            <span
              className={`${selectedIds.size > 0 || selectedIds.has(row.id) ? 'opacity-100' : 'opacity-0 group-focus-within/card:opacity-100 group-hover/card:opacity-100'} absolute top-4 left-4 z-10 transition-opacity`}
            >
              <Checkbox
                aria-label={`Select ${workViewRowTitle(row)}`}
                checked={selectedIds.has(row.id)}
                onClick={(event) => event.stopPropagation()}
                onChange={() => toggle(row.id)}
              />
            </span>
            <DocketLink
              href={buildEntityHref(entityNavigationSnapshotFromWorkViewRow(row))}
              className="focus-visible:ring-primary block min-h-36 rounded-xl p-4 outline-none focus-visible:ring-2"
              onClick={(event) => {
                if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                onActivate(row);
              }}
            >
              <div className="flex items-start gap-3">
                <span aria-hidden className="size-6 shrink-0" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-title-medium truncate">{workViewRowTitle(row)}</h2>
                  {properties.length > 0 ? (
                    <dl className="text-on-surface-variant text-body-small mt-3 grid gap-1">
                      {properties.map((field) => (
                        <div key={field.key} className="flex min-w-0 gap-2">
                          <dt className="shrink-0">{field.label}</dt>
                          <dd className="truncate">
                            {formatWorkViewValue(
                              workViewRowDisplayValue(row, field.key),
                              field.kind,
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </div>
              </div>
            </DocketLink>
          </WorkObjectCard>
        ))}
      </div>
      {hasMoreRows && onLoadMoreRows ? (
        <Button
          type="button"
          variant="ghost"
          controlSize="sm"
          className="mx-auto my-3"
          disabled={loadingMoreRows}
          onClick={onLoadMoreRows}
        >
          {loadingMoreRows ? 'Loading more' : `Load more ${target}s`}
        </Button>
      ) : null}
    </div>
  );
}
