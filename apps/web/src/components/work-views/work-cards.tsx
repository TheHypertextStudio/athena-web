'use client';

import { defaultEntityDisplay } from '@docket/work/entity-display-contract';
import { entityNavigationSnapshotFromWorkViewRow } from '../../lib/contracts/entity-navigation';
import { Button, Card, Checkbox } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import type { ViewTarget } from '@docket/work/view-contract';
import { type JSX, type ReactNode } from 'react';

import { useRelationDropTarget } from '@/components/dnd/use-relation-drop-target';
import { ObjectSurface } from '@/components/objects/object-surface';
import { useSelection } from '@/components/selection';

import DocketLink from '@/components/docket-link';
import { buildEntityHref } from '@/lib/authenticated-route';
import { EntityIconGlyph } from '@/components/entity-display/entity-icon-glyph';
import { objectKey } from '@/lib/actions/object';

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
import {
  objectForWorkViewRow,
  workViewRowInteractionPolicy,
  workViewSelectionObject,
} from './work-view-object';
import { ProgramWorkCard } from './program-work-card';

function WorkObjectCard<TTarget extends ViewTarget>({
  row,
  routeOrganizationId,
  canContribute,
  onActivate,
  children,
}: {
  readonly row: WorkViewRowFor<TTarget>;
  readonly routeOrganizationId: string;
  readonly canContribute: boolean;
  readonly onActivate: () => void;
  readonly children: ReactNode;
}): JSX.Element {
  const object = objectForWorkViewRow(row);
  const interaction = workViewRowInteractionPolicy(row, routeOrganizationId, canContribute);
  const selectableObject = workViewSelectionObject(row, routeOrganizationId);
  const selection = useSelection();
  const selected = selectableObject !== null && selection.isSelected(objectKey(selectableObject));
  const drop = useRelationDropTarget({ target: object, disabled: !interaction.writable });
  return (
    <ObjectSurface
      object={object}
      objects={selected ? selection.selectedObjects : [object]}
      dragDisabled={interaction.dragDisabled}
      actionScope={interaction.actionScope}
      surfaceId={selection.surfaceId}
      onActivate={onActivate}
    >
      <Card
        ref={drop.dropProps.ref}
        role="listitem"
        tabIndex={0}
        data-drop-state={drop.dropState}
        data-selecting={selection.count > 0}
        data-selected={selected}
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
  readonly organizationId: string;
  readonly canContribute: boolean;
  readonly definition: WorkViewDefinitionFor<TTarget>;
  readonly rows: readonly WorkViewRowFor<TTarget>[];
  readonly onActivate: (row: WorkViewRowFor<TTarget>) => void;
  readonly hasMoreRows?: boolean;
  readonly loadingMoreRows?: boolean;
  readonly onLoadMoreRows?: (() => void) | undefined;
}

/** Render a responsive card grid while preserving shared interaction behavior around target-specific content. */
export function WorkCards<TTarget extends ViewTarget>({
  target,
  organizationId,
  canContribute,
  definition,
  rows,
  onActivate,
  hasMoreRows = false,
  loadingMoreRows = false,
  onLoadMoreRows,
}: WorkCardsProps<TTarget>): JSX.Element {
  const selection = useSelection();
  const propertyKeys: ReadonlySet<string> = new Set(definition.presentation.properties);
  // Programs read the key set and lay their own card out, so the label/kind catalog is built only
  // for the targets whose card renders a generic property list from it.
  const properties =
    target === 'program'
      ? []
      : workViewDisplayFieldCatalog(target).filter((field) => propertyKeys.has(field.key));
  const visibleRows = rows.filter((row) => !row.isContext);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto">
      <div
        role="list"
        aria-label={`${target.charAt(0).toUpperCase()}${target.slice(1)} cards`}
        className={CARD_GRID_CLASS}
      >
        {visibleRows.map((row) => {
          const selectableObject = workViewSelectionObject(row, organizationId);
          const selected =
            selectableObject !== null && selection.isSelected(objectKey(selectableObject));
          return (
            <WorkObjectCard
              key={row.id}
              row={row}
              routeOrganizationId={organizationId}
              canContribute={canContribute}
              onActivate={() => {
                onActivate(row);
              }}
            >
              {/*
               * Laid over the card's leading glyph, which fades beneath it, and outside the link so
               * a click selects instead of navigating. Its inset matches the content's, so it lands
               * in the column rather than the gutter.
               */}
              {selectableObject !== null ? (
                <span
                  data-selection-slot=""
                  className={cn(
                    CARD_CHECKBOX_REVEAL_CLASS,
                    'absolute top-4 left-4 z-10 flex size-10 items-center justify-center',
                  )}
                >
                  <Checkbox
                    aria-label={`Select ${workViewRowTitle(row)}`}
                    checked={selected}
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                    onChange={() => {
                      selection.dispatch({ type: 'toggle', key: objectKey(selectableObject) });
                    }}
                  />
                </span>
              ) : null}
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
          );
        })}
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
