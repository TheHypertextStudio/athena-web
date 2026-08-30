'use client';

import { defaultEntityDisplay, entityNavigationSnapshotFromWorkViewRow } from '@docket/types';
import { Button, Card, Checkbox } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import type { ViewTarget } from '@docket/work/view-contract';
import { type JSX, type ReactNode } from 'react';

import { useRelationDropTarget } from '@/components/dnd/use-relation-drop-target';
import { ObjectSurface } from '@/components/objects/object-surface';

import DocketLink from '@/components/docket-link';
import { buildEntityHref } from '@/lib/authenticated-route';
import { EntityIconGlyph } from '@/components/entity-display/entity-icon-glyph';

import {
  CARD_CHECKBOX_REVEAL_CLASS,
  CARD_GLYPH_FADE_CLASS,
  CARD_GRID_CLASS,
  CARD_INSET,
  CARD_MIN_HEIGHT,
} from './card-styles';
import type { WorkViewDefinitionFor } from './view-state';
import { workViewDisplayFieldCatalog } from './view-state';
import {
  formatWorkViewValue,
  type WorkViewRowFor,
  workViewRowDisplayValue,
  workViewRowTitle,
} from './renderer-types';
import { objectForWorkViewRow } from './work-view-object';
import { ProgramWorkCard } from './program-work-card';

function WorkObjectCard<TTarget extends ViewTarget>({
  row,
  onActivate,
  selecting,
  children,
}: {
  readonly row: WorkViewRowFor<TTarget>;
  readonly onActivate: () => void;
  readonly selecting: boolean;
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
        data-selecting={selecting}
        className={cn(
          'group/card focus-visible:ring-primary hover:bg-surface-container-high relative cursor-pointer transition-colors outline-none focus-visible:ring-2',
          CARD_MIN_HEIGHT,
          drop.dropProps.className,
          // The accept/reject treatment the List lens draws on a row, so a drop target reads the
          // same whichever lens you are in.
          drop.dropState === 'accept' && 'ring-primary bg-primary/8 z-10 ring-2 ring-inset',
          drop.dropState === 'reject' && 'ring-error/60 bg-error/5 z-10 ring-1 ring-inset',
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

/** Render the stored decorative identity for a projected work row. */
function CardIdentity({ row }: { row: WorkViewRowFor<ViewTarget> }): JSX.Element {
  const display = row.display ?? defaultEntityDisplay(row.target, row.id);
  return (
    <EntityIconGlyph
      iconKey={display.iconKey}
      colorKey={display.colorKey}
      customColor={display.customColor}
      size={24}
    />
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

/** Render a responsive card grid while preserving shared interaction behavior around target-specific content. */
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
  const propertyKeys: ReadonlySet<string> = new Set(definition.presentation.properties);
  // Programs read the key set and lay their own card out, so the label/kind catalog is built only
  // for the targets whose card renders a generic property list from it.
  const properties =
    target === 'program'
      ? []
      : workViewDisplayFieldCatalog(target).filter((field) => propertyKeys.has(field.key));
  const selecting = selectedIds.size > 0;
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
        className={CARD_GRID_CLASS}
      >
        {rows.map((row) => (
          <WorkObjectCard
            key={row.id}
            row={row}
            selecting={selecting}
            onActivate={() => {
              onActivate(row);
            }}
          >
            {/*
             * Laid over the card's leading glyph, which fades beneath it, and outside the link so
             * a click selects instead of navigating. Its inset matches the content's, so it lands
             * in the column rather than the gutter.
             */}
            <span
              data-selection-slot=""
              className={cn(
                CARD_CHECKBOX_REVEAL_CLASS,
                'absolute top-4 left-4 z-10 flex size-10 items-center justify-center',
              )}
            >
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
            </span>
            <DocketLink
              href={buildEntityHref(entityNavigationSnapshotFromWorkViewRow(row))}
              className={cn(
                'focus-visible:ring-primary flex h-full flex-col rounded-xl outline-none focus-visible:ring-2',
                CARD_INSET,
              )}
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
              {row.target === 'program' ? (
                <ProgramWorkCard row={row} properties={propertyKeys} />
              ) : (
                <div className="flex min-w-0 flex-col gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={CARD_GLYPH_FADE_CLASS}>
                      <CardIdentity row={row} />
                    </span>
                    <h2
                      title={workViewRowTitle(row)}
                      className="text-title-medium line-clamp-2 min-w-0 flex-1"
                    >
                      {workViewRowTitle(row)}
                    </h2>
                  </div>
                  {properties.length > 0 ? (
                    <dl className="text-on-surface-variant text-body-small grid gap-1">
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
              )}
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
