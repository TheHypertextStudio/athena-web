'use client';

/**
 * The view-tab row: built-in tabs, saved views, and the Project dependency lens.
 *
 * @remarks
 * Lifted out of `work-view-page.tsx` so the page function describes its layout rather than also
 * rendering one of its controls, and so the saved-views failure affordance sits next to the tabs it
 * degrades alongside.
 */
import { Heart } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { SavedViewsRetry } from './work-view-failures';

/** One saved view as the tab row needs it. */
export interface WorkViewTabEntry {
  readonly id: string;
  readonly name: string;
}

/** Props for the work-view tab row. */
export interface WorkViewTabsProps {
  /** Plural surface name, e.g. `Projects`. */
  readonly title: string;
  readonly savedViews: readonly WorkViewTabEntry[];
  readonly favoriteViewIds: ReadonlySet<string>;
  readonly selectedViewId: string | null;
  readonly dependencyMode: boolean;
  /** Only Projects have a dependency lens. */
  readonly showDependencies: boolean;
  readonly savedViewsError: unknown;
  /** Suppresses the saved-views affordance while the content itself has failed. */
  readonly contentFailed: boolean;
  readonly onSelect: (viewId: string | null, dependencies: boolean) => void;
  readonly onToggleFavorite: (viewId: string) => void;
  readonly onRetrySavedViews: () => void;
}

/** One saved view's tab, paired with its favorite toggle. */
function SavedViewTab({
  view,
  favorite,
  selected,
  onSelect,
  onToggleFavorite,
}: {
  readonly view: WorkViewTabEntry;
  readonly favorite: boolean;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onToggleFavorite: () => void;
}): JSX.Element {
  return (
    <div className="flex shrink-0 items-center">
      <Button
        role="tab"
        controlSize="sm"
        className="shrink-0 rounded-full"
        variant={selected ? 'secondary' : 'ghost'}
        aria-selected={selected}
        onClick={onSelect}
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
        onClick={onToggleFavorite}
      >
        <Heart aria-hidden className={favorite ? 'text-primary' : undefined} />
      </Button>
    </div>
  );
}

/**
 * Render the view-tab row for one work-view surface.
 *
 * @param props - The tabs to draw, which is selected, and the saved-views failure state.
 * @returns the tablist, ending in a quiet retry when saved views could not load.
 */
export function WorkViewTabs({
  title,
  savedViews,
  favoriteViewIds,
  selectedViewId,
  dependencyMode,
  showDependencies,
  savedViewsError,
  contentFailed,
  onSelect,
  onToggleFavorite,
  onRetrySavedViews,
}: WorkViewTabsProps): JSX.Element {
  const lower = title.toLowerCase();
  const allSelected = !dependencyMode && selectedViewId === null;
  return (
    <div
      role="tablist"
      aria-label={`${title} views`}
      className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
    >
      <Button
        role="tab"
        controlSize="sm"
        className="shrink-0 rounded-full"
        aria-label={`All ${lower}`}
        variant={allSelected ? 'secondary' : 'ghost'}
        aria-selected={allSelected}
        onClick={() => {
          onSelect(null, false);
        }}
      >
        <span aria-hidden className="sm:hidden">
          All
        </span>
        <span aria-hidden className="hidden sm:inline">
          All {lower}
        </span>
      </Button>
      {savedViews.map((view) => (
        <SavedViewTab
          key={view.id}
          view={view}
          favorite={favoriteViewIds.has(view.id)}
          selected={!dependencyMode && selectedViewId === view.id}
          onSelect={() => {
            onSelect(view.id, false);
          }}
          onToggleFavorite={() => {
            onToggleFavorite(view.id);
          }}
        />
      ))}
      {showDependencies ? (
        <Button
          role="tab"
          controlSize="sm"
          className="shrink-0 rounded-full"
          variant={dependencyMode ? 'secondary' : 'ghost'}
          aria-selected={dependencyMode}
          onClick={() => {
            onSelect(null, true);
          }}
        >
          Dependencies
        </Button>
      ) : null}
      <SavedViewsRetry
        error={savedViewsError}
        contentFailed={contentFailed}
        onRetry={onRetrySavedViews}
      />
    </div>
  );
}
