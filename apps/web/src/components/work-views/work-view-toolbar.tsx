'use client';

import { Ellipsis, Filter } from '@docket/ui/icons';
import {
  Button,
  Chip,
  ControlGroup,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Stack,
} from '@docket/ui/primitives';
import type { ViewTarget } from '@docket/work/view-contract';
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';

import {
  DisplayControls,
  DisplayControlsContent,
  DisplayControlsTrigger,
} from './display-controls';
import { FilterBuilder } from './filter-builder';
import { SortBuilder, SortBuilderTrigger } from './sort-builder';
import {
  combineWorkViewFilters,
  parseWorkViewDefinition,
  type WorkViewDefinitionFor,
  type WorkViewFacetResponseForTarget,
  type WorkViewFilterFieldKey,
  type WorkViewFilterFor,
  type WorkViewFilterShape,
  workViewFilterFieldCatalog,
  workViewFieldCatalog,
} from './view-state';

type ToolbarControl = 'sort' | 'group' | 'layout' | 'properties' | 'default';
type ToolbarPriority = 0 | 1 | 2 | 3 | 4 | 5;

const CONTROL_PRIORITY = {
  sort: 1,
  group: 2,
  layout: 3,
  properties: 4,
  default: 5,
} as const satisfies Record<ToolbarControl, ToolbarPriority>;

const PRIORITY_MIN_WIDTH: Readonly<Record<ToolbarPriority, number>> = {
  0: 0,
  1: 720,
  2: 840,
  3: 960,
  4: 1080,
  5: 1200,
};

const CONTROL_LABEL = {
  sort: 'Sort',
  group: 'Group',
  layout: 'Layout',
  properties: 'Properties',
  default: 'Set as default',
} as const satisfies Record<ToolbarControl, string>;

/** Return the highest lower-priority toolbar tier that fits the measured container. */
export function visibleToolbarPriority(width: number): ToolbarPriority {
  let result: ToolbarPriority = 0;
  for (const priority of [1, 2, 3, 4, 5] as const) {
    if (width < PRIORITY_MIN_WIDTH[priority]) break;
    result = priority;
  }
  return result;
}

function targetLabel(target: ViewTarget): string {
  return `${target.charAt(0).toUpperCase()}${target.slice(1)}`;
}

function sameOperand(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function operandLabel<TTarget extends ViewTarget>(
  value: unknown,
  field: WorkViewFilterFieldKey<TTarget>,
  target: TTarget,
  facets?: WorkViewFacetResponseForTarget<TTarget>,
): string {
  if (Array.isArray(value)) {
    return value.map((item) => operandLabel(item, field, target, facets)).join(', ');
  }
  if (typeof value === 'object' && value !== null && 'kind' in value) {
    if (value.kind === 'current-actor') return 'Me';
    if ('value' in value && typeof value.value === 'string') return value.value;
  }
  const kind = workViewFilterFieldCatalog(target).find((candidate) =>
    sameKey(candidate.key, field),
  )?.kind;
  if (kind === 'relation-one' || kind === 'relation-many') {
    const named = facets?.buckets
      .find((bucket) => sameKey(bucket.field, field))
      ?.options.find((option) => sameOperand(option.value, value))?.label;
    if (named) return named;
  }
  if (typeof value === 'object' && value !== null && 'actorId' in value) return 'Selected person';
  if (typeof value === 'string') {
    return kind === 'relation-one' || kind === 'relation-many' ? 'Selected value' : value;
  }
  return String(value);
}

function sameKey(left: unknown, right: unknown): boolean {
  return left === right;
}

function formulaNodes<TTarget extends ViewTarget>(
  filter: WorkViewFilterFor<TTarget> | null,
): readonly WorkViewFilterShape<TTarget>[] {
  if (!filter) return [];
  return filter.kind === 'all' ? filter.children : [filter];
}

function describeFilter<TTarget extends ViewTarget>(
  filter: WorkViewFilterShape<TTarget>,
  target: TTarget,
  facets?: WorkViewFacetResponseForTarget<TTarget>,
): string {
  if (filter.kind === 'not') return `Not ${describeFilter(filter.child, target, facets)}`;
  if (filter.kind === 'all' || filter.kind === 'any') {
    return `${filter.kind === 'all' ? 'All' : 'Any'} of ${String(filter.children.length)} filters`;
  }
  if (!('field' in filter)) return 'Filter';
  const label =
    workViewFieldCatalog(target).find((field) => sameKey(field.key, filter.field))?.label ??
    filter.field;
  const operator = filter.operator.replace(/([A-Z])/g, ' $1').toLowerCase();
  return 'operand' in filter
    ? `${label} ${operator} ${operandLabel(filter.operand, filter.field, target, facets)}`
    : `${label} ${operator}`;
}

/** Props for the shared, target-derived work-view toolbar. */
export interface WorkViewToolbarProps<TTarget extends ViewTarget> {
  readonly target: TTarget;
  readonly timezone?: string;
  readonly definition: WorkViewDefinitionFor<TTarget>;
  readonly onDefinitionChange: (definition: WorkViewDefinitionFor<TTarget>) => void;
  readonly onSaveView: () => void;
  readonly onSetDefault: () => void;
  readonly canSetDefault?: boolean;
  readonly facetResponse?: WorkViewFacetResponseForTarget<TTarget> | undefined;
  readonly facetMetadataResponse?: WorkViewFacetResponseForTarget<TTarget> | undefined;
  readonly facetLoading?: boolean;
  readonly facetHasMore?: boolean;
  readonly facetLoadingMore?: boolean;
  readonly onFacetLoadMore?: () => void;
  readonly onFacetRequest?: (field: WorkViewFilterFieldKey<TTarget>, search: string) => void;
}

/** Render one compact non-wrapping toolbar with an exact visible/overflow partition. */
export function WorkViewToolbar<TTarget extends ViewTarget>({
  target,
  timezone,
  definition,
  onDefinitionChange,
  onSaveView,
  onSetDefault,
  canSetDefault = true,
  facetResponse,
  facetMetadataResponse,
  facetLoading = false,
  facetHasMore = false,
  facetLoadingMore = false,
  onFacetLoadMore,
  onFacetRequest,
}: WorkViewToolbarProps<TTarget>): ReactElement {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [visiblePriority, setVisiblePriority] = useState<ToolbarPriority>(0);
  const [overflowPanel, setOverflowPanel] = useState<ToolbarControl | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [editingFilterIndex, setEditingFilterIndex] = useState<number | null>(null);
  const controls = useMemo<readonly ToolbarControl[]>(
    () => ['sort', 'group', 'layout', 'properties', ...(canSetDefault ? ['default' as const] : [])],
    [canSetDefault],
  );
  const visibleControls = controls.filter(
    (control) => CONTROL_PRIORITY[control] <= visiblePriority,
  );
  const hiddenControls = controls.filter((control) => CONTROL_PRIORITY[control] > visiblePriority);

  useEffect(() => {
    const element = toolbarRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setVisiblePriority(visibleToolbarPriority(entry.contentRect.width));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  function commit(next: WorkViewDefinitionFor<TTarget>): void {
    onDefinitionChange(parseWorkViewDefinition(target, next));
  }

  function renderControl(control: ToolbarControl): ReactElement {
    if (control === 'sort') {
      return (
        <SortBuilder
          key={control}
          target={target}
          terms={definition.arrangement.orderBy}
          onChange={(orderBy) => {
            commit({
              ...definition,
              arrangement: { ...definition.arrangement, orderBy },
            });
          }}
          trigger={<SortBuilderTrigger />}
        />
      );
    }
    if (control === 'default') {
      return (
        <Button key={control} variant="ghost" aria-label="Set as default" onClick={onSetDefault}>
          Set as default
        </Button>
      );
    }
    return (
      <DisplayControls
        key={control}
        kind={control}
        target={target}
        definition={definition}
        onChange={commit}
        trigger={<DisplayControlsTrigger kind={control} />}
      />
    );
  }

  const filter = definition.filter;
  const nodes = formulaNodes(filter);
  const editingNode = editingFilterIndex === null ? null : (nodes[editingFilterIndex] ?? null);
  const filterToEdit =
    editingFilterIndex === null
      ? filter
      : editingNode
        ? combineWorkViewFilters(target, [editingNode])
        : null;

  return (
    <Stack gap={2}>
      <div ref={toolbarRef} className="min-w-0">
        <ControlGroup
          controlSize="sm"
          role="toolbar"
          aria-label={`${targetLabel(target)} view controls`}
          className="w-full flex-nowrap overflow-x-hidden"
        >
          <FilterBuilder
            key={`${editingFilterIndex === null ? 'all' : String(editingFilterIndex)}:${JSON.stringify(filterToEdit)}`}
            target={target}
            filter={filterToEdit}
            {...(timezone ? { timezone } : {})}
            open={filterOpen}
            onOpenChange={(next) => {
              setFilterOpen(next);
              if (!next) setEditingFilterIndex(null);
            }}
            facetResponse={facetResponse}
            facetLoading={facetLoading}
            facetHasMore={facetHasMore}
            facetLoadingMore={facetLoadingMore}
            onFacetLoadMore={onFacetLoadMore}
            onFacetRequest={onFacetRequest}
            onApply={(nextFilter) => {
              if (editingFilterIndex === null) {
                commit({ ...definition, filter: nextFilter });
                return;
              }
              const replacement = formulaNodes(nextFilter);
              const nextNodes = nodes.flatMap((node, index) =>
                index === editingFilterIndex ? replacement : [node],
              );
              commit({ ...definition, filter: combineWorkViewFilters(target, nextNodes) });
            }}
            trigger={
              <Chip icon={<Filter aria-hidden />} variant="filter" selected={filter !== null}>
                Filter
              </Chip>
            }
          />
          {visibleControls.map(renderControl)}
          <span className="flex-1" aria-hidden />
          <Button variant="secondary" aria-label="Save view" onClick={onSaveView}>
            Save view
          </Button>
          {hiddenControls.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" iconOnly aria-label="More view controls">
                  <Ellipsis aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" aria-label="More view controls">
                {hiddenControls.map((control) => (
                  <DropdownMenuItem
                    key={control}
                    onSelect={() => {
                      if (control === 'default') onSetDefault();
                      else setOverflowPanel(control);
                    }}
                  >
                    {CONTROL_LABEL[control]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </ControlGroup>
      </div>

      {nodes.length > 0 ? (
        <ControlGroup
          as="ul"
          controlSize="xs"
          aria-label="Active filters"
          className="flex-nowrap overflow-x-auto"
        >
          {nodes.map((node, index) => {
            const description = describeFilter(
              node,
              target,
              facetMetadataResponse ?? facetResponse,
            );
            return (
              <li key={`${description}-${String(index)}`}>
                <Chip
                  icon={<Filter aria-hidden />}
                  variant="input"
                  onClick={() => {
                    setEditingFilterIndex(index);
                    setFilterOpen(true);
                  }}
                  onRemove={() => {
                    const remaining = nodes.filter((_, current) => current !== index);
                    const nextFilter = combineWorkViewFilters(target, remaining);
                    commit({ ...definition, filter: nextFilter });
                  }}
                  removeLabel={`Remove filter ${description}`}
                >
                  {description}
                </Chip>
              </li>
            );
          })}
        </ControlGroup>
      ) : null}

      <Dialog
        open={overflowPanel !== null}
        onOpenChange={(next) => {
          if (!next) setOverflowPanel(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {overflowPanel ? `${CONTROL_LABEL[overflowPanel]} view` : 'View controls'}
            </DialogTitle>
            <DialogDescription>
              Change the arrangement and presentation for this view.
            </DialogDescription>
          </DialogHeader>
          {overflowPanel === 'sort' ? (
            <SortBuilder
              target={target}
              terms={definition.arrangement.orderBy}
              onChange={(orderBy) => {
                commit({
                  ...definition,
                  arrangement: { ...definition.arrangement, orderBy },
                });
              }}
            />
          ) : null}
          {overflowPanel === 'group' ||
          overflowPanel === 'layout' ||
          overflowPanel === 'properties' ? (
            <DisplayControlsContent
              kind={overflowPanel}
              target={target}
              definition={definition}
              onChange={(nextDefinition) => {
                commit(nextDefinition);
                if (overflowPanel === 'layout') setOverflowPanel(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Stack>
  );
}
