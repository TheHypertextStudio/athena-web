'use client';

import {
  entityNavigationSnapshotFromWorkViewRow,
  InitiativeViewDefinition,
  type InitiativeViewRow,
  OrganizationId,
  pageOf,
  ProgramViewDefinition,
  ProjectViewDefinition,
  ProjectId,
  type ProjectViewRow,
  SavedWorkViewOut,
  type SavedWorkViewOut as SavedWorkViewOutValue,
  TaskViewDefinition,
  TeamId,
  type ViewScope,
  ViewInstanceKey,
} from '@docket/types';
import { EmptyState } from '@docket/ui/components';
import { FolderKanban, Heart, Layers, ListChecks, Plus, Target, X } from '@docket/ui/icons';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenuItem,
  DropdownMenuLabel,
  Input,
  Select,
  Skeleton,
} from '@docket/ui/primitives';
import type { ViewTarget } from '@docket/work/view-contract';
import { Fragment, type JSX, useCallback, useEffect, useRef, useState } from 'react';

import { useCreateObject } from '@/components/create-object/create-object-provider';
import { useActiveOrg } from '@/components/active-org';
import { InPageSearchField } from '@/components/in-page-search/in-page-search-field';
import { useInPageSearchTarget } from '@/components/in-page-search/in-page-search-provider';
import { ListPageLayout } from '@/components/views/page-layout';
import { api } from '@/lib/api';
import { navigateAuthenticated } from '@/lib/app-location';
import { openEntity } from '@/lib/local-first-navigation';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, type RpcResponse, useApiQuery } from '@/lib/query';

import { InitiativeTimeline } from './initiative-timeline';
import { ProjectDependencyLens } from './project-dependency-lens';
import { ProjectTimelineAdapter } from './project-timeline-adapter';
import type { WorkViewRowFor } from './renderer-types';
import { useWorkView } from './use-work-view';
import { useWorkViewOrder } from './use-work-view-order';
import { useProjectTimelineMutations } from './use-project-timeline-mutations';
import type { WorkViewDefinitionFor } from './view-state';
import { WorkBoard } from './work-board';
import { WorkCards } from './work-cards';
import { WorkList } from './work-list';
import { WorkViewLoadFailure } from './work-view-load-failure';
import { supportsWorkViewRenderer } from './work-view-renderers';
import { WorkViewToolbar } from './work-view-toolbar';

const FALLBACKS = {
  task: TaskViewDefinition.parse({
    version: 2,
    target: 'task',
    filter: null,
    arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
    presentation: {
      layout: 'list',
      properties: ['status', 'priority', 'assignee', 'dueDate'],
      density: 'compact',
      showEmptyGroups: false,
    },
  }),
  project: ProjectViewDefinition.parse({
    version: 2,
    target: 'project',
    filter: null,
    arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
    presentation: {
      layout: 'list',
      properties: ['status', 'priority', 'health', 'lead', 'targetDate', 'progress'],
      density: 'compact',
      showEmptyGroups: false,
    },
  }),
  program: ProgramViewDefinition.parse({
    version: 2,
    target: 'program',
    filter: null,
    arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
    presentation: {
      layout: 'list',
      properties: ['status', 'health', 'owner', 'projectCount', 'taskCount'],
      density: 'compact',
      showEmptyGroups: false,
    },
  }),
  initiative: InitiativeViewDefinition.parse({
    version: 2,
    target: 'initiative',
    filter: null,
    arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
    presentation: {
      layout: 'list',
      properties: ['status', 'priority', 'health', 'owner', 'targetDate'],
      density: 'compact',
      showEmptyGroups: false,
    },
  }),
} as const;

const PAGE_COPY = {
  task: { title: 'Tasks', singular: 'task', icon: ListChecks },
  project: { title: 'Projects', singular: 'project', icon: FolderKanban },
  program: { title: 'Programs', singular: 'program', icon: Layers },
  initiative: { title: 'Initiatives', singular: 'initiative', icon: Target },
} as const;

const SavedWorkViewPage = pageOf(SavedWorkViewOut);

interface CreatedProjectSelection {
  readonly organizationId: string;
  readonly id: string;
  readonly state: 'pending' | 'missing';
  readonly attempt: number;
}

async function savedViewsResponse(
  organizationId: string,
): Promise<RpcResponse<ReturnType<typeof SavedWorkViewPage.parse>>> {
  const response = await api.v1.orgs[':orgId']['saved-views'].$get({
    param: { orgId: organizationId },
  });
  if (!response.ok) return response;
  const value = SavedWorkViewPage.parse(await response.json());
  return { ok: true, status: response.status, json: async () => value };
}

/** Props for one organization-level typed planning roster. */
export interface WorkViewPageProps<TTarget extends ViewTarget> {
  readonly organizationId: string;
  readonly target: TTarget;
}

function fallbackFor<TTarget extends ViewTarget>(target: TTarget): WorkViewDefinitionFor<TTarget> {
  return FALLBACKS[target] as WorkViewDefinitionFor<TTarget>;
}

/** Render one organization roster from the shared server query and target contract. */
export function WorkViewPage<TTarget extends ViewTarget>({
  organizationId,
  target,
}: WorkViewPageProps<TTarget>): JSX.Element {
  const { openCreate } = useCreateObject();
  const { teams } = useActiveOrg();
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [copiedSelection, setCopiedSelection] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [viewScope, setViewScope] = useState<ViewScope>('personal');
  const [viewTeamId, setViewTeamId] = useState('');
  const [dependencyMode, setDependencyMode] = useState(false);
  const [createdProjectSelection, setCreatedProjectSelection] =
    useState<CreatedProjectSelection | null>(null);
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [findOpen, setFindOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const activeOrganizationIdRef = useRef(organizationId);
  activeOrganizationIdRef.current = organizationId;
  const copy = PAGE_COPY[target];
  const savedViewsQuery = useApiQuery(
    apiQueryOptions(
      queryKeys.savedViews(organizationId),
      () => savedViewsResponse(organizationId),
      'Could not load saved views.',
    ),
  );
  const savedViews = (savedViewsQuery.data?.items ?? [])
    .filter((view) => view.target === target)
    .sort((left, right) => left.position.localeCompare(right.position));
  const selectedSavedView = savedViews.find((view) => view.id === selectedViewId) ?? null;
  const controller = useWorkView({
    organizationId,
    target,
    instanceKey: selectedSavedView
      ? ViewInstanceKey.parse(`saved:${selectedSavedView.id}`)
      : ViewInstanceKey.parse(`builtin:${target}:${organizationId}`),
    fallback: fallbackFor(target),
    context: { kind: 'organization' },
    search,
    savedView: selectedSavedView as Extract<SavedWorkViewOutValue, { target: TTarget }> | null,
  });
  const orderMutation = useWorkViewOrder(organizationId);
  const projectTimeline = useProjectTimelineMutations(organizationId);
  // The target discriminator was validated by `useWorkView`. TypeScript loses that correlation
  // when it indexes the four response variants through a generic target.
  const rows = (controller.response?.rows ?? []) as unknown as readonly WorkViewRowFor<TTarget>[];
  const requestedLayout = controller.definition.presentation.layout;
  const layout = supportsWorkViewRenderer(target, requestedLayout) ? requestedLayout : 'list';
  const { openSearch, restoreFocus } = useInPageSearchTarget({
    id: `work-view:${target}`,
    rootRef,
    inputRef: searchInputRef,
    enabled: layout === 'list' && !dependencyMode && !controller.loading && !controller.error,
    onOpen: () => {
      setFindOpen(true);
    },
  });
  const openRow = (row: WorkViewRowFor<TTarget>): void => {
    openEntity(entityNavigationSnapshotFromWorkViewRow(row));
  };
  useEffect(() => {
    setCreatedProjectSelection((selection) =>
      selection?.organizationId === organizationId ? selection : null,
    );
  }, [organizationId]);
  const resolveCreatedProjectSelection = useCallback(
    (projectId: string): void => {
      if (activeOrganizationIdRef.current !== organizationId) return;
      setCreatedProjectSelection((selection) =>
        selection?.organizationId === organizationId && selection.id === projectId
          ? null
          : selection,
      );
    },
    [organizationId],
  );
  const markCreatedProjectMissing = useCallback(
    (projectId: string): void => {
      if (activeOrganizationIdRef.current !== organizationId) return;
      setCreatedProjectSelection((selection) =>
        selection?.organizationId === organizationId && selection.id === projectId
          ? { ...selection, state: 'missing' }
          : selection,
      );
    },
    [organizationId],
  );
  const activeCreatedProjectSelection =
    createdProjectSelection?.organizationId === organizationId ? createdProjectSelection : null;
  const create = (path: readonly string[] = [], returnFocusTo?: HTMLElement | null): void => {
    const applyColumn = (itemId: string): void => {
      const groupValue = path[0] ?? null;
      if (path.length === 0) return;
      orderMutation.mutate({
        target,
        itemId,
        groupField: controller.definition.arrangement.groupBy,
        sourceGroupValue: null,
        groupValue: groupValue === '__empty__' ? null : groupValue,
        beforeId: null,
        afterId: null,
      });
    };
    const base = { initialWorkspaceId: organizationId, sameWorkspaceCompletion: 'open' } as const;
    switch (target) {
      case 'task':
        openCreate({
          ...base,
          kind: 'task',
          onCreated: (item) => {
            applyColumn(item.id);
          },
        });
        return;
      case 'project':
        openCreate(
          {
            initialWorkspaceId: organizationId,
            sameWorkspaceCompletion: dependencyMode ? 'stay' : 'open',
            kind: 'project',
            onCreated: (item) => {
              applyColumn(item.id);
              if (dependencyMode && activeOrganizationIdRef.current === organizationId) {
                setCreatedProjectSelection({
                  organizationId,
                  id: item.id,
                  state: 'pending',
                  attempt: 0,
                });
              }
            },
          },
          returnFocusTo,
        );
        return;
      case 'program':
        openCreate({
          ...base,
          kind: 'program',
          onCreated: (item) => {
            applyColumn(item.id);
          },
        });
        return;
      case 'initiative':
        openCreate({
          ...base,
          kind: 'initiative',
          onCreated: (item) => {
            applyColumn(item.id);
          },
        });
        return;
    }
  };

  let content: JSX.Element;
  if (target === 'project' && dependencyMode) {
    content = (
      <ProjectDependencyLens
        organizationId={organizationId}
        requestedSelectionId={activeCreatedProjectSelection?.id ?? null}
        requestedSelectionAttempt={activeCreatedProjectSelection?.attempt ?? 0}
        onRequestedSelectionResolved={resolveCreatedProjectSelection}
        onRequestedSelectionMissing={markCreatedProjectMissing}
        onCreateProject={(returnFocusTo) => {
          create([], returnFocusTo);
        }}
      />
    );
  } else if (controller.loading) {
    content = (
      <div
        className="bg-surface-container-low h-full min-h-0 rounded-xl p-2"
        aria-label={`Loading ${copy.title.toLowerCase()}`}
      >
        <div className="h-8 px-3 py-2">
          <Skeleton className="h-3 w-24 rounded" />
        </div>
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="flex h-14 items-center gap-3 rounded-lg px-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <Skeleton className="h-3.5 w-[min(28rem,45%)] rounded" />
            <span className="flex-1" />
            <Skeleton className="hidden h-3 w-24 rounded @2xl:block" />
            <Skeleton className="hidden h-3 w-20 rounded @2xl:block" />
          </div>
        ))}
      </div>
    );
  } else if (controller.error) {
    content = (
      <WorkViewLoadFailure
        title={copy.title}
        retrying={controller.retrying}
        onRetry={controller.retry}
      />
    );
  } else if ((controller.response?.totalCount ?? 0) === 0) {
    content = (
      <EmptyState
        icon={copy.icon}
        title={`No ${copy.title.toLowerCase()} yet`}
        cta={{ label: `Create ${copy.singular}`, onClick: create }}
      />
    );
  } else if (layout === 'board') {
    content = (
      <WorkBoard
        target={target}
        definition={controller.definition}
        rows={rows}
        groups={controller.response?.groups ?? []}
        groupPages={controller.groupPages}
        hiddenColumns={controller.hiddenBoardColumns}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onCreate={(path) => {
          create(path);
        }}
        onActivate={openRow}
        onDrop={(drop) => {
          const groupValue = drop.destinationPath[0] ?? null;
          const sourceGroupValue = drop.sourcePath[0] ?? null;
          orderMutation.mutate({
            target,
            itemId: drop.item.id,
            groupField: controller.definition.arrangement.groupBy,
            sourceGroupValue: sourceGroupValue === '__empty__' ? null : sourceGroupValue,
            groupValue: groupValue === '__empty__' ? null : groupValue,
            beforeId: drop.beforeId,
            afterId: drop.afterId,
          });
        }}
        onLoadMore={controller.loadMoreGroup}
        hasMoreRows={controller.response?.nextCursor !== null}
        loadingMoreRows={controller.loadingMoreRows}
        onLoadMoreRows={controller.loadMoreRows}
        onHideColumn={controller.toggleHiddenBoardColumn}
        onShowAllColumns={controller.showAllBoardColumns}
      />
    );
  } else if (layout === 'cards') {
    content = (
      <WorkCards
        target={target}
        definition={controller.definition}
        rows={rows}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onActivate={openRow}
        hasMoreRows={controller.response?.nextCursor !== null}
        loadingMoreRows={controller.loadingMoreRows}
        onLoadMoreRows={controller.loadMoreRows}
      />
    );
  } else if (target === 'project' && layout === 'timeline') {
    content = (
      <ProjectTimelineAdapter
        organizationId={organizationId}
        rows={rows as unknown as readonly ProjectViewRow[]}
        density={controller.definition.presentation.density}
        canSchedule
        onReschedule={projectTimeline.reschedule}
        onApplyCascade={projectTimeline.applyCascade}
        applyingCascade={projectTimeline.applyingCascade}
        onActivate={(id) => {
          const row = rows.find((candidate) => candidate.id === id);
          if (row !== undefined) openRow(row);
        }}
        onPrefetch={() => undefined}
      />
    );
  } else if (target === 'initiative' && layout === 'timeline') {
    content = (
      <InitiativeTimeline
        organizationId={organizationId}
        rows={rows as unknown as readonly InitiativeViewRow[]}
        density={controller.definition.presentation.density}
        onActivate={(id) => {
          const row = rows.find((candidate) => candidate.id === id);
          if (row !== undefined) openRow(row);
        }}
        onPrefetch={() => undefined}
      />
    );
  } else {
    content = (
      <WorkList
        target={target}
        definition={controller.definition}
        rows={rows}
        groups={controller.response?.groups ?? []}
        groupPages={controller.groupPages}
        selectedIds={selectedIds}
        collapsedGroups={controller.collapsedGroups}
        onSelectionChange={setSelectedIds}
        onActivate={openRow}
        onLoadMore={controller.loadMoreGroup}
        hasMoreRows={controller.response?.nextCursor !== null}
        loadingMoreRows={controller.loadingMoreRows}
        onLoadMoreRows={controller.loadMoreRows}
        onToggleGroup={controller.toggleCollapsedGroup}
      />
    );
  }

  const viewTabs = (
    <div
      role="tablist"
      aria-label={`${copy.title} views`}
      className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
    >
      <Button
        role="tab"
        controlSize="sm"
        className="shrink-0 rounded-full"
        aria-label={`All ${copy.title.toLowerCase()}`}
        variant={!dependencyMode && selectedViewId === null ? 'secondary' : 'ghost'}
        aria-selected={!dependencyMode && selectedViewId === null}
        onClick={() => {
          setDependencyMode(false);
          setSelectedViewId(null);
        }}
      >
        <span aria-hidden className="sm:hidden">
          All
        </span>
        <span aria-hidden className="hidden sm:inline">
          All {copy.title.toLowerCase()}
        </span>
      </Button>
      {savedViews.map((view) => {
        const favorite = controller.favoriteViewIds.has(view.id);
        return (
          <div key={view.id} className="flex shrink-0 items-center">
            <Button
              role="tab"
              controlSize="sm"
              className="shrink-0 rounded-full"
              variant={selectedViewId === view.id ? 'secondary' : 'ghost'}
              aria-selected={!dependencyMode && selectedViewId === view.id}
              onClick={() => {
                setDependencyMode(false);
                setSelectedViewId(view.id);
              }}
            >
              {view.name}
            </Button>
            <Button
              type="button"
              variant="ghost"
              iconOnly
              controlSize="sm"
              aria-label={`${favorite ? 'Remove' : 'Add'} ${view.name} ${favorite ? 'from' : 'to'} favorites`}
              aria-pressed={favorite}
              onClick={() => {
                controller.toggleFavoriteView(view.id);
              }}
            >
              <Heart aria-hidden className={favorite ? 'text-primary' : undefined} />
            </Button>
          </div>
        );
      })}
      {target === 'project' ? (
        <Button
          role="tab"
          controlSize="sm"
          className="shrink-0 rounded-full"
          variant={dependencyMode ? 'secondary' : 'ghost'}
          aria-selected={dependencyMode}
          onClick={() => {
            setDependencyMode(true);
            setSelectedViewId(null);
          }}
        >
          Dependencies
        </Button>
      ) : null}
    </div>
  );

  const viewOverflowItems = (
    <>
      <DropdownMenuLabel>Views</DropdownMenuLabel>
      <DropdownMenuItem
        selected={!dependencyMode && selectedViewId === null}
        onSelect={() => {
          setDependencyMode(false);
          setSelectedViewId(null);
        }}
      >
        All {copy.title.toLowerCase()}
      </DropdownMenuItem>
      {savedViews.map((view) => {
        const favorite = controller.favoriteViewIds.has(view.id);
        return (
          <Fragment key={view.id}>
            <DropdownMenuItem
              selected={!dependencyMode && selectedViewId === view.id}
              onSelect={() => {
                setDependencyMode(false);
                setSelectedViewId(view.id);
              }}
            >
              {view.name}
            </DropdownMenuItem>
            <DropdownMenuItem
              inset
              onSelect={() => {
                controller.toggleFavoriteView(view.id);
              }}
            >
              {favorite ? `Remove ${view.name} from favorites` : `Add ${view.name} to favorites`}
            </DropdownMenuItem>
          </Fragment>
        );
      })}
      {target === 'project' ? (
        <DropdownMenuItem
          selected={dependencyMode}
          onSelect={() => {
            setDependencyMode(true);
            setSelectedViewId(null);
          }}
        >
          Dependencies
        </DropdownMenuItem>
      ) : null}
    </>
  );

  return (
    <div ref={rootRef} className="contents">
      <ListPageLayout
        title={copy.title}
        fill
        actions={
          <Button
            className="min-h-10 gap-1.5"
            onClick={() => {
              create();
            }}
          >
            <Plus aria-hidden className="size-4" /> New {copy.singular}
          </Button>
        }
        toolbar={
          <div className="flex min-w-0 flex-col gap-2">
            {!dependencyMode && findOpen ? (
              <InPageSearchField
                inputRef={searchInputRef}
                value={search}
                onValueChange={setSearch}
                onEscapeEmpty={() => {
                  setFindOpen(false);
                  restoreFocus();
                }}
                label={`Search ${copy.title}`}
                placeholder={`Search ${copy.title.toLowerCase()}`}
                resultCount={controller.response?.totalCount ?? 0}
                pending={controller.loading}
                className="w-full @2xl:max-w-md"
              />
            ) : null}
            <WorkViewToolbar
              target={target}
              timezone={controller.timezone}
              definition={controller.definition}
              onDefinitionChange={controller.setDefinition}
              leading={viewTabs}
              overflowItems={viewOverflowItems}
              showQueryControls={!dependencyMode}
              onSaveView={() => {
                setSaveOpen(true);
              }}
              onSetDefault={controller.setAsDefault}
              onReset={controller.resetPersonalOverride}
              onFind={(restoreElement) => {
                openSearch(restoreElement);
              }}
              facetResponse={controller.facetResponse}
              facetMetadataResponse={controller.facetMetadataResponse}
              facetLoading={controller.facetLoading}
              facetHasMore={controller.facetHasMore}
              facetLoadingMore={controller.facetLoadingMore}
              onFacetLoadMore={controller.loadMoreFacets}
              onFacetRequest={controller.requestFacet}
            />
          </div>
        }
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {projectTimeline.error || orderMutation.error ? (
            <p role="alert" className="text-error text-body-medium px-3 py-2">
              {projectTimeline.error
                ? userErrorMessage(projectTimeline.error, 'Could not reschedule this project.')
                : userErrorMessage(orderMutation.error, `Could not move this ${copy.singular}.`)}
            </p>
          ) : null}
          {target === 'project' &&
          dependencyMode &&
          activeCreatedProjectSelection?.state === 'missing' ? (
            <div className="bg-secondary-container text-on-secondary-container text-body-medium flex shrink-0 items-center gap-2 rounded-lg px-3 py-2">
              <span role="status" className="min-w-0 flex-1">
                Created, but hidden by current filters
              </span>
              <Button
                variant="ghost"
                controlSize="sm"
                onClick={() => {
                  controller.setDefinition({ ...controller.definition, filter: null });
                  setSearch('');
                  setCreatedProjectSelection((selection) =>
                    selection?.organizationId === organizationId &&
                    selection.id === activeCreatedProjectSelection.id
                      ? {
                          ...selection,
                          state: 'pending',
                          attempt: selection.attempt + 1,
                        }
                      : selection,
                  );
                }}
              >
                Clear filters
              </Button>
              <Button
                variant="ghost"
                controlSize="sm"
                onClick={() => {
                  setCreatedProjectSelection(null);
                  navigateAuthenticated('/orgs/[orgId]/projects/[projectId]', {
                    orgId: OrganizationId.parse(organizationId),
                    projectId: ProjectId.parse(activeCreatedProjectSelection.id),
                  });
                }}
              >
                Open project
              </Button>
              <Button
                variant="ghost"
                iconOnly
                controlSize="sm"
                aria-label="Dismiss created Project notice"
                onClick={() => {
                  setCreatedProjectSelection(null);
                }}
              >
                <X aria-hidden />
              </Button>
            </div>
          ) : null}
          {content}
        </div>
        {selectedIds.size > 0 ? (
          <div
            role="toolbar"
            aria-label="Bulk actions"
            className="border-outline-variant bg-surface-container-high text-body-medium flex min-h-12 shrink-0 items-center gap-3 rounded-xl border px-4"
          >
            <span>{selectedIds.size} selected</span>
            <Button
              variant="secondary"
              onClick={() => {
                const links = [...selectedIds].map(
                  (id) => `${window.location.origin}/orgs/${organizationId}/${target}s/${id}`,
                );
                void navigator.clipboard.writeText(links.join('\n')).then(() => {
                  setCopiedSelection(true);
                });
              }}
            >
              {copiedSelection ? 'Copied' : 'Copy links'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setSelectedIds(new Set());
                setCopiedSelection(false);
              }}
            >
              Clear
            </Button>
          </div>
        ) : null}
        <Dialog
          open={saveOpen}
          onOpenChange={(open) => {
            setSaveOpen(open);
            if (!open) {
              setViewName('');
              setViewScope('personal');
              setViewTeamId('');
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save view</DialogTitle>
            </DialogHeader>
            <label className="text-label-large flex flex-col gap-2">
              View name
              <Input
                autoFocus
                value={viewName}
                onChange={(event) => {
                  setViewName(event.target.value);
                }}
              />
            </label>
            <label className="text-label-large flex flex-col gap-2">
              Share with
              <Select
                value={viewScope}
                onChange={(event) => {
                  const scope = event.target.value as ViewScope;
                  setViewScope(scope);
                  if (scope !== 'team') setViewTeamId('');
                }}
              >
                <option value="personal">Only me</option>
                <option value="team">A team</option>
                <option value="organization">Everyone in this workspace</option>
              </Select>
            </label>
            {viewScope === 'team' ? (
              <label className="text-label-large flex flex-col gap-2">
                Team
                <Select
                  value={viewTeamId}
                  onChange={(event) => {
                    setViewTeamId(event.target.value);
                  }}
                >
                  <option value="">Choose a team</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  setSaveOpen(false);
                  setViewName('');
                  setViewScope('personal');
                  setViewTeamId('');
                }}
              >
                Cancel
              </Button>
              <Button
                disabled={
                  viewName.trim().length === 0 ||
                  controller.saving ||
                  (viewScope === 'team' && viewTeamId.length === 0)
                }
                onClick={() => {
                  controller.saveView({
                    name: viewName.trim(),
                    scope: viewScope,
                    ...(viewScope === 'team' ? { teamId: TeamId.parse(viewTeamId) } : {}),
                  });
                  setSaveOpen(false);
                  setViewName('');
                  setViewScope('personal');
                  setViewTeamId('');
                }}
              >
                {controller.saving ? 'Saving…' : 'Save view'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </ListPageLayout>
    </div>
  );
}
