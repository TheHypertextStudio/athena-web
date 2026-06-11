'use client';

/**
 * The org "Saved Views" screen (mvp-plan §8.3d).
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/views`, rendered in the app-shell main region
 * (the shell's integrated sidebar already wraps `(app)` routes). A saved view is a
 * stored filter/grouping/sort over the org's tasks, with a sharing {@link ViewScope} (personal
 * / team / org). The screen does three things:
 *
 * 1. **Lists** the org's saved views ({@link ViewList}) — name, scope badge, and a one-line
 *    summary of what each filters/groups.
 * 2. **Opens** a view: its stored `filters`/`grouping`/`sort` become the active working query,
 *    which the unified {@link FilterToolbar} shows (and lets you tweak) and the
 *    {@link ViewRunner} renders as a grouped task {@link ListView}.
 * 3. **Saves** the current working query as a new view ({@link SaveViewComposer}).
 *
 * This screen drives the *same* {@link FilterToolbar} as every entity list, over a task
 * {@link FieldCatalog} ({@link buildTaskCatalog}); the stored saved-view config is bridged to the
 * unified {@link ViewState} via {@link toViewState}/{@link toStoredView}, so opening a view,
 * tweaking it, and saving it round-trips losslessly. Unlike the entity lists, the working query
 * lives in local state (not the URL), because this screen's state is "which saved view is open",
 * not a sticky per-page filter.
 *
 * Views are *shareable but permission-filtered*: the tasks endpoint returns only work the
 * caller may access, so the runner renders exactly the rows it is handed — a shared view simply
 * shows a viewer fewer tasks, never an error. The screen never re-implements access control.
 *
 * Entity-noun labels (project/program) flow through {@link useVocabulary} into the catalog so the
 * org's vocabulary skin applies everywhere a field, group header, or filter chip names an entity.
 * All data is fetched at runtime, so the production build needs no running server.
 */
import { LayoutGrid, Plus } from '@docket/ui/icons';
import { Button, Separator, Skeleton } from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX } from 'react';

import { FilterToolbar } from '@/components/views/filter-toolbar';
import { SaveViewComposer } from '@/components/views/save-view-composer';
import { ViewList } from '@/components/views/view-list';
import { ViewRunner } from '@/components/views/view-runner';
import { useViewsPage } from './use-views-page';

export default function ViewsPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const {
    views,
    tasks,
    loading,
    loadError,
    viewsLabel,
    query,
    setQuery,
    composerOpen,
    setComposerOpen,
    catalog,
    querySummary,
    canScopeToTeam,
    saving,
    saveError,
    save,
    resetSave,
    openView,
    storedQuery,
    openViewName,
    resolveActor,
  } = useViewsPage(orgId);

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-on-surface text-h1">Views</h1>
        <p className="text-on-surface-variant text-xs">
          Saved filters over your {viewsLabel.toLowerCase()} — open one, tweak it, or save the
          current filter as a new view. Shared views show each person only the work they can see.
        </p>
      </header>

      {loading ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ) : loadError ? (
        <p role="alert" className="text-destructive text-body">
          {loadError}
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          <section aria-label="Saved views" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-on-surface-variant text-xs font-medium">
                {views.length === 0 ? 'No saved views yet' : `${String(views.length)} saved`}
              </h2>
            </div>
            {views.length === 0 ? (
              <div className="border-outline-variant text-on-surface-variant text-body flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center">
                <LayoutGrid className="size-6 opacity-60" aria-hidden="true" />
                <p>
                  Build a filter below and save it to create your first view. Views can stay
                  personal or be shared with your team or organization.
                </p>
              </div>
            ) : (
              <ViewList
                views={views}
                activeId={query.sourceViewId}
                onOpen={openView}
                catalog={catalog}
              />
            )}
          </section>

          <Separator />

          <section aria-label="Working view" className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-on-surface text-body font-semibold">
                {openViewName ?? 'New view'}
              </h2>
            </div>

            <FilterToolbar
              catalog={catalog}
              state={query.state}
              onFiltersChange={(filters) => {
                setQuery((current) => ({ ...current, state: { ...current.state, filters } }));
              }}
              onGroupByChange={(groupBy) => {
                setQuery((current) => ({ ...current, state: { ...current.state, groupBy } }));
              }}
              onSortChange={(sort) => {
                setQuery((current) => ({ ...current, state: { ...current.state, sort } }));
              }}
              saveSlot={
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    resetSave();
                    setComposerOpen((open) => !open);
                  }}
                  aria-expanded={composerOpen}
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  Save as view
                </Button>
              }
            />

            {composerOpen ? (
              <SaveViewComposer
                filters={storedQuery.filters}
                grouping={storedQuery.grouping}
                sort={storedQuery.sort}
                summary={querySummary}
                canScopeToTeam={canScopeToTeam}
                saving={saving}
                error={saveError}
                onSave={(payload) => {
                  save(payload);
                }}
                onCancel={() => {
                  setComposerOpen(false);
                }}
              />
            ) : null}

            <div className="border-outline-variant min-h-64 flex-1 overflow-hidden rounded-xl border">
              <ViewRunner
                tasks={tasks}
                state={query.state}
                catalog={catalog}
                resolveActor={resolveActor}
                label={openViewName ?? 'Working view tasks'}
                onOpenTask={(taskId) => {
                  router.push(`/orgs/${orgId}/tasks/${taskId}`);
                }}
              />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
