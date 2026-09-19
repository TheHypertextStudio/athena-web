'use client';

/**
 * The view-tab row: built-in tabs, saved views, and the way to the Project dependencies page.
 *
 * @remarks
 * Lifted out of `work-view-page.tsx` so the page function describes its layout rather than also
 * rendering one of its controls, and so the saved-views failure affordance sits next to the tabs it
 * degrades alongside. The dependencies entry is a link to its own page, so it is never the selected
 * tab of this row.
 */
import { Heart } from '@docket/ui/icons';
import { Button, DropdownMenuItem, DropdownMenuLabel } from '@docket/ui/primitives';
import { Fragment, type JSX } from 'react';

import DocketLink from '@/components/docket-link';
import { transitionNameStyle } from '@/lib/view-transition';

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
  /** Where the Dependencies entry goes; null for a target with no dependencies page. */
  readonly dependenciesHref: string | null;
  /** A `view-transition-name` for the row, so the dependencies page's lens switch morphs from it. */
  readonly transitionName?: string | undefined;
  readonly savedViewsError: unknown;
  /** Suppresses the saved-views affordance while the content itself has failed. */
  readonly contentFailed: boolean;
  readonly onSelect: (viewId: string | null) => void;
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
  dependenciesHref,
  transitionName,
  savedViewsError,
  contentFailed,
  onSelect,
  onToggleFavorite,
  onRetrySavedViews,
}: WorkViewTabsProps): JSX.Element {
  const lower = title.toLowerCase();
  const allSelected = selectedViewId === null;
  return (
    <div
      role="tablist"
      aria-label={`${title} views`}
      style={transitionNameStyle(transitionName)}
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
          onSelect(null);
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
          selected={selectedViewId === view.id}
          onSelect={() => {
            onSelect(view.id);
          }}
          onToggleFavorite={() => {
            onToggleFavorite(view.id);
          }}
        />
      ))}
      {dependenciesHref === null ? null : (
        <Button
          asChild
          role="tab"
          controlSize="sm"
          className="shrink-0 rounded-full"
          variant="ghost"
          aria-selected={false}
        >
          <DocketLink href={dependenciesHref} transition="shared-element">
            Dependencies
          </DocketLink>
        </Button>
      )}
      <SavedViewsRetry
        error={savedViewsError}
        contentFailed={contentFailed}
        onRetry={onRetrySavedViews}
      />
    </div>
  );
}

/** Props for {@link WorkViewOverflowItems}. */
export interface WorkViewOverflowItemsProps {
  /** Plural surface name, e.g. `Projects`. */
  readonly title: string;
  readonly savedViews: readonly WorkViewTabEntry[];
  readonly favoriteViewIds: ReadonlySet<string>;
  readonly selectedViewId: string | null;
  /** Where the Dependencies entry goes; null for a target with no dependencies page. */
  readonly dependenciesHref: string | null;
  readonly onSelect: (viewId: string | null) => void;
  readonly onToggleFavorite: (viewId: string) => void;
}

/**
 * The same views as the tab row, as menu items, for the More menu that keeps them reachable when
 * the row clips.
 *
 * @param props - The views to list, which is selected, and where Dependencies leads.
 * @returns the menu's Views group.
 */
export function WorkViewOverflowItems({
  title,
  savedViews,
  favoriteViewIds,
  selectedViewId,
  dependenciesHref,
  onSelect,
  onToggleFavorite,
}: WorkViewOverflowItemsProps): JSX.Element {
  return (
    <>
      <DropdownMenuLabel>Views</DropdownMenuLabel>
      <DropdownMenuItem
        selected={selectedViewId === null}
        onSelect={() => {
          onSelect(null);
        }}
      >
        All {title.toLowerCase()}
      </DropdownMenuItem>
      {savedViews.map((view) => {
        const favorite = favoriteViewIds.has(view.id);
        return (
          <Fragment key={view.id}>
            <DropdownMenuItem
              selected={selectedViewId === view.id}
              onSelect={() => {
                onSelect(view.id);
              }}
            >
              {view.name}
            </DropdownMenuItem>
            <DropdownMenuItem
              inset
              onSelect={() => {
                onToggleFavorite(view.id);
              }}
            >
              {favorite ? `Remove ${view.name} from favorites` : `Add ${view.name} to favorites`}
            </DropdownMenuItem>
          </Fragment>
        );
      })}
      {dependenciesHref === null ? null : (
        <DropdownMenuItem asChild>
          <DocketLink href={dependenciesHref} transition="shared-element">
            Dependencies
          </DocketLink>
        </DropdownMenuItem>
      )}
    </>
  );
}
