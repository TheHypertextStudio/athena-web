'use client';

import { Ellipsis, Filter } from '@docket/ui/icons';
import {
  Button,
  Chip,
  ControlGroup,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Stack,
} from '@docket/ui/primitives';
import type { ViewTarget } from '@docket/work/view-contract';
import { type ReactElement, type ReactNode, useState } from 'react';

import { DisplayControls, DisplayControlsTrigger } from './display-controls';
import { FilterBuilder } from './filter-builder';
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
  readonly onReset: () => void;
  /** View chips that lead the same control row as filter and display. */
  readonly leading?: ReactNode;
  /** Open the target's temporary finder from Display. */
  readonly onFind?: () => void;
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
  onReset,
  leading,
  onFind,
  canSetDefault = true,
  facetResponse,
  facetMetadataResponse,
  facetLoading = false,
  facetHasMore = false,
  facetLoadingMore = false,
  onFacetLoadMore,
  onFacetRequest,
}: WorkViewToolbarProps<TTarget>): ReactElement {
  const [filterOpen, setFilterOpen] = useState(false);
  const [editingFilterIndex, setEditingFilterIndex] = useState<number | null>(null);

  function commit(next: WorkViewDefinitionFor<TTarget>): void {
    onDefinitionChange(parseWorkViewDefinition(target, next));
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
      <div className="min-w-0">
        <ControlGroup
          controlSize="sm"
          role="toolbar"
          aria-label={`${targetLabel(target)} view controls`}
          className="w-full flex-nowrap overflow-x-hidden"
        >
          {leading}
          <span className="flex-1" aria-hidden />
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
              <Button
                variant={filter !== null ? 'secondary' : 'ghost'}
                iconOnly
                aria-label="Filter"
                className="rounded-full"
              >
                <Filter aria-hidden />
              </Button>
            }
          />
          <DisplayControls
            kind="display"
            target={target}
            definition={definition}
            onChange={commit}
            onFind={onFind}
            trigger={<DisplayControlsTrigger kind="display" iconOnly className="rounded-full" />}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" iconOnly aria-label="View settings" className="rounded-full">
                <Ellipsis aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" aria-label="View settings">
              <DropdownMenuItem onSelect={onSaveView}>Save view</DropdownMenuItem>
              {canSetDefault ? (
                <DropdownMenuItem onSelect={onSetDefault}>Set as default</DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={onReset}>Reset to default</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
    </Stack>
  );
}
