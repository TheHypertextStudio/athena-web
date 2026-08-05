'use client';

/**
 * `@docket/ui` — `AppBar`, the persistent chrome band at the top of a surface.
 *
 * @remarks
 * A page's masthead and its view controls are one piece of furniture, so they are one component.
 * Built this way for two reasons the graph page made obvious:
 *
 * 1. **One tonal band, no rules.** The header and the toolbar used to be separate blocks divided
 *    from each other — and from the content below — by `outline-variant` hairlines, which drew
 *    three horizontal lines across the top of every page. `AppBar` is a single {@link Surface} at
 *    the `chrome` step, so the band separates itself from the content by tone. Callers name slots;
 *    they never reach for a background utility.
 * 2. **It cannot wrap.** Persistent UI holds one row at every width. Both rows here are
 *    `flex-nowrap`, the title truncates, and the `controls` slot is expected to collapse its own
 *    overflow into a menu. A bar whose height depends on the viewport reflows the page under it.
 *
 * ## The navigation slot is an icon, not a sentence
 *
 * MD3's top app bar opens with a navigation icon, and the destination lives in its accessible
 * name. A text link beside the heading instead reads as a subtitle — "Dependency graph · Back to
 * workspace" parses as one phrase, and the eye has to work out that half of it is a control. The
 * slot therefore takes an icon button, rendered *before* the title where a reader looks for it.
 *
 * @example
 * ```tsx
 * <AppBar
 *   title="Dependency graph"
 *   navigation={<BackButton href={…} label="Back to workspace" />}
 *   actions={<Button …>Share</Button>}
 *   controls={<FilterToolbar … />}
 * />
 * ```
 */
import * as React from 'react';

import { cn } from '../../lib/utils';
import { Surface } from '../../primitives/surface';

/** Props for {@link AppBar}. */
export interface AppBarProps {
  /**
   * The page title. A string is rendered in the canonical title token; a node is rendered as-is,
   * for a surface whose title is an inline-edit field or carries a badge.
   */
  title: React.ReactNode;
  /**
   * The navigation affordance, rendered before the title — typically a back button.
   *
   * @remarks
   * Expected to be an icon button whose `aria-label` names the destination, per MD3's leading
   * navigation icon. Putting a labelled link here instead turns the masthead into a sentence.
   */
  navigation?: React.ReactNode;
  /** Trailing slot, pinned to the end of the title row — page-level actions. */
  actions?: React.ReactNode;
  /**
   * The view controls row beneath the title — a filter bar, a lens switcher, a segmented control.
   *
   * @remarks
   * Rendered inside the same tonal band rather than below it, so the chrome reads as one region.
   * Whatever goes here owns its own overflow: this row does not wrap.
   */
  controls?: React.ReactNode;
  /** Extra classes merged onto the band. */
  className?: string;
}

/**
 * The persistent chrome band: a title row, optional actions, and an optional controls row.
 *
 * @param props - The {@link AppBarProps}.
 * @returns the chrome band.
 */
export function AppBar({
  title,
  navigation,
  actions,
  controls,
  className,
}: AppBarProps): React.JSX.Element {
  return (
    <Surface
      as="header"
      tone="card"
      shape="none"
      className={cn('flex flex-col gap-2 px-4 pt-3 pb-2.5 @2xl:px-6', className)}
    >
      <div className="flex min-w-0 flex-nowrap items-center gap-2">
        {navigation}
        {typeof title === 'string' ? (
          <h1 className="text-on-surface text-title-medium min-w-0 truncate">{title}</h1>
        ) : (
          title
        )}
        {actions ? (
          <>
            <span className="flex-1" aria-hidden="true" />
            {actions}
          </>
        ) : null}
      </div>
      {controls ? <div className="flex min-w-0 flex-nowrap items-center">{controls}</div> : null}
    </Surface>
  );
}
