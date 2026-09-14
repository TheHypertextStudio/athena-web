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
 *    the `card` step, so the band separates itself from the content by tone. Callers name slots;
 *    they never reach for a background utility.
 * 2. **It cannot wrap.** Persistent UI holds one row at every width. Both rows here are
 *    `flex-nowrap`, the title truncates, and the `controls` slot is expected to collapse its own
 *    overflow into a menu. A bar whose height depends on the viewport reflows the page under it.
 *
 * A surface that runs edge to edge underneath its chrome, such as a canvas, asks for the
 * `floating` presentation instead: one row on the floating tone, controls beside the title, placed
 * by the caller over the surface. In that row the title is what gives way: it takes the room the
 * fixed slots leave, up to its own length, and truncates before anything else moves. `controls`
 * and `actions` never shrink. The `fill` slot is the one flexible region, for a group that
 * scrolls inside its own box when the row runs short.
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
  /**
   * How the bar sits on the page.
   *
   * @remarks
   * `band` (the default) is the persistent chrome band above a surface: a title row and an
   * optional controls row on the `card` tone. `floating` is one row on the `floating` tone, for a
   * surface that runs edge to edge underneath it, such as a canvas; the caller positions it, and
   * `controls` shares the row with the title. A floating bar is a region landmark, so it needs an
   * accessible name.
   */
  presentation?: 'band' | 'floating';
  /** The landmark name of a floating bar. Required when `presentation` is `floating`. */
  'aria-label'?: string;
  /**
   * The flexible region of a floating bar, between the controls and the actions.
   *
   * @remarks
   * The one slot that shrinks: whatever goes here owns its own overflow, typically by scrolling.
   * Ignored by the `band` presentation, whose controls row already spans the band.
   */
  fill?: React.ReactNode;
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
  presentation = 'band',
  'aria-label': ariaLabel,
  fill,
}: AppBarProps): React.JSX.Element {
  if (presentation === 'floating') {
    return (
      <Surface
        as="section"
        tone="floating"
        shape="large"
        aria-label={ariaLabel}
        className={cn('flex min-w-0 flex-nowrap items-center gap-2 p-2', className)}
      >
        {navigation}
        {typeof title === 'string' ? (
          <h1 className="text-on-surface text-title-medium max-w-fit min-w-16 grow basis-0 truncate">
            {title}
          </h1>
        ) : (
          title
        )}
        {controls ? (
          <div className="flex shrink-0 flex-nowrap items-center gap-2">{controls}</div>
        ) : null}
        {fill ? <div className="flex min-w-0 flex-nowrap items-center gap-2">{fill}</div> : null}
        {actions ? (
          <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-2">{actions}</div>
        ) : null}
      </Surface>
    );
  }
  const heading =
    typeof title === 'string' ? (
      <h1 className="text-on-surface text-title-medium min-w-0 truncate">{title}</h1>
    ) : (
      title
    );
  return (
    <Surface
      as="header"
      tone="card"
      shape="none"
      // `pt-3 pb-2.5` was 12px over 10px for no reason anyone could name, and the block padding
      // was the only inset here that did not step with the pane while the inline one did. Both are
      // symmetric and stepped now. They stay smaller than the inline inset on purpose: this is a
      // band, not a page — a single row given a page's 24px on every side would be a 90px bar.
      className={cn('flex flex-col gap-2 px-4 py-3 @2xl:px-6 @2xl:py-4', className)}
    >
      <div className="flex min-w-0 flex-nowrap items-center gap-2">
        {navigation}
        {heading}
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
