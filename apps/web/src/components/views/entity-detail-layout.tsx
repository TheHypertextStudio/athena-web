/**
 * `views` — the one canonical entity-detail shell that project / initiative / program detail pages
 * compose.
 *
 * @remarks
 * Every strategic-work detail page used to hand-roll its own masthead: some put the status chip
 * inline with the title, some hid properties behind a popover, some floated them in a right rail,
 * and the title size drifted between surfaces. {@link EntityDetailLayout} fixes the *arrangement*
 * once — the icon sits above the title + subtitle pair, and the title fills the available width
 * instead of being clipped to a fixed measure — a metadata slot for the full inline property row,
 * then the tab bar with a separator beneath it and the active panel — so a page only supplies
 * content through slots. The canonical title token (`text-headline-medium font-medium`) is owned
 * here so no page can diverge from it.
 */
import { useOwnPageScroll } from '@docket/ui/components';
import { cn } from '@docket/ui/lib/utils';
import type { JSX, ReactNode } from 'react';

import { PageContainer } from './page-layout';

/** Props for {@link EntityDetailLayout}. */
export interface EntityDetailLayoutProps {
  /**
   * A full-bleed banner across the very top of the page, behind everything else.
   *
   * @remarks
   * Edge to edge on purpose. A cover inset inside the content padding is just a picture *in* the
   * page; a cover that spans the top is the page's header, which is the only version worth having.
   * The masthead is pulled up so the icon straddles its lower edge, exactly as a team card does, so
   * identity and cover read as one object rather than a caption under a photograph.
   */
  cover?: ReactNode;
  /** The breadcrumb (e.g. the Initiative breadcrumb), sharing a row with {@link actions}. */
  eyebrow?: ReactNode;
  /** The entity icon rendered above the title (an editable picker or a static glyph, ~40px). */
  icon: ReactNode;
  /** The title content (e.g. an inline-editable title); the layout owns the canonical token. */
  title: ReactNode;
  /** The one-line summary rendered directly under the identity pair. */
  subtitle?: ReactNode;
  /** The inline metadata row — typically an {@link EntityMetadataRow} of property pickers. */
  metadata?: ReactNode;
  /** Masthead actions (e.g. the ⋯ menu), sharing the eyebrow row rather than the title's. */
  actions?: ReactNode;
  /** The tab bar (a `Tabs` element). A {@link Separator} is rendered directly beneath it. */
  tabs: ReactNode;
  /** The active tab panel's content. */
  children: ReactNode;
  /** Extra container classes (e.g. a page print scope). */
  className?: string;
}

/**
 * The standard entity-detail arrangement.
 *
 * @remarks
 * Renders (top to bottom): an eyebrow/actions row, a masthead whose identity pair stacks the icon
 * above the title + subtitle (title filling the available width, subtitle wrapping like ordinary
 * text), the metadata row, then the tab bar, then the active panel. `actions` shares the eyebrow's
 * row rather than the title's — a title can run to any length without ever having to compete with
 * the ⋯ menu or the publish action for width, so it never gets squeezed into clipping. Status/
 * health and every other property live in the metadata slot, never inline with the title.
 *
 * @param props - The {@link EntityDetailLayoutProps}.
 * @returns the composed detail page.
 */
export function EntityDetailLayout({
  cover,
  eyebrow,
  icon,
  title,
  subtitle,
  metadata,
  actions,
  tabs,
  children,
  className,
}: EntityDetailLayoutProps): JSX.Element {
  if (cover) {
    return (
      <CoverDetailLayout
        {...{ cover, eyebrow, icon, title, subtitle, metadata, actions, tabs, children, className }}
      />
    );
  }

  return (
    <PageContainer className={className}>
      {eyebrow || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">{eyebrow}</div>
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </div>
      ) : null}
      <header className="flex flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="shrink-0">{icon}</div>
          <h1 className="text-on-surface text-headline-medium w-full min-w-0 font-medium">
            {title}
          </h1>
          {subtitle ? (
            <div className="text-on-surface-variant text-body-large w-full min-w-0">{subtitle}</div>
          ) : null}
        </div>
        {metadata}
      </header>
      {tabs}
      {children}
    </PageContainer>
  );
}

/**
 * The shared class for a metadata property chip: a low-chrome pill trigger sized to the inline row.
 *
 * @remarks
 * Pass to each picker's `triggerClassName` (with `triggerVariant="ghost"`) so every property in the
 * metadata row reads as the same calm, tappable chip.
 */
export const ENTITY_METADATA_CHIP_CLASS =
  'bg-surface-container-low hover:bg-surface-container-high min-h-10 gap-1.5 rounded-full px-3';

/** Props for {@link EntityMetadataRow}. */
export interface EntityMetadataRowProps {
  /** Accessible label for the property group (e.g. "Project properties"). */
  ariaLabel: string;
  /** The property chips (pickers) to lay out inline. */
  children: ReactNode;
}

/**
 * The inline, wrapping row that holds all of an entity's property chips below the identity block.
 *
 * @param props - The {@link EntityMetadataRowProps}.
 * @returns a labelled group wrapping its property chips.
 */
export function EntityMetadataRow({ ariaLabel, children }: EntityMetadataRowProps): JSX.Element {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap items-center gap-2">
      {children}
    </div>
  );
}

/**
 * The banner variant: one scrolling column with a pinned masthead.
 *
 * @remarks
 * The page takes ownership of scrolling ({@link useOwnPageScroll}), so the shell's `<main>` stops
 * being a scroll container. That is what lets the banner reach the pane's right edge — `<main>`
 * reserves a permanent scrollbar gutter while it scrolls (11px, measured) and no child can cross
 * it.
 *
 * The masthead is `sticky`, not collapsible-by-height. Shrinking the banner on scroll was the
 * obvious reading of "semi-collapsible" and it oscillates: collapsing gives height back to the
 * panel, which removes the overflow that triggered the collapse, which expands it again. Sticky
 * has no such loop because the column's height never changes — the banner simply scrolls up and
 * out under a masthead that stays put, which is also what Linear's detail pages actually do.
 *
 * The identity row is `sticky` too, one layer above the banner and directly below nothing, so
 * title, tabs and the way back stay reachable at any scroll depth.
 */
function CoverDetailLayout({
  cover,
  eyebrow,
  icon,
  title,
  subtitle,
  metadata,
  actions,
  tabs,
  children,
  className,
}: EntityDetailLayoutProps): JSX.Element {
  useOwnPageScroll();

  return (
    // The one scrolling box on the page. No stable scrollbar gutter here: reserving one would
    // inset the banner from the pane's right edge, which is the whole reason the page took
    // ownership of scrolling in the first place.
    <div data-detail-panel-scroll="" className="h-full min-h-0 w-full overflow-y-auto">
      <div className="relative h-32 w-full @2xl:h-44">
        {cover}
        {/* Eyebrow and actions share one row over the banner, matching the row they share when
            there is no banner. Each sits in its own blurred pill, which keeps a back link and a
            menu legible over artwork nobody chose for legibility. */}
        {eyebrow || actions ? (
          <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 px-3 pt-3 @2xl:px-6 @2xl:pt-4 @4xl:px-8">
            {eyebrow ? (
              <div className="bg-surface/70 min-w-0 rounded-full px-2 py-1 backdrop-blur-sm">
                {eyebrow}
              </div>
            ) : (
              <span />
            )}
            {actions ? (
              <div className="bg-surface/70 flex shrink-0 items-center gap-1 rounded-full px-1 backdrop-blur-sm">
                {actions}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* `relative z-10` is load-bearing: the banner above lives in a positioned box, and a
          positioned element paints in a later layer than a non-positioned sibling — so without
          this the banner draws over the icon that deliberately overlaps it, which reads exactly
          like a transparency bug and is paint order. */}
      <div
        className={cn(
          'bg-surface relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-3 px-3 @2xl:px-6 @4xl:px-8',
          className,
        )}
      >
        <header className="-mt-10 flex flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            {/* An opaque disc, not just a ring: every entity glyph paints its tint at ~15% alpha,
                so straddling the banner would otherwise let the cover composite through the icon. */}
            <div className="bg-surface ring-surface w-fit shrink-0 rounded-full ring-4">{icon}</div>
            <h1 className="text-on-surface text-headline-medium w-full min-w-0 font-medium">
              {title}
            </h1>
            {subtitle ? (
              <div className="text-on-surface-variant text-body-large w-full min-w-0">
                {subtitle}
              </div>
            ) : null}
          </div>
          {metadata}
        </header>
      </div>

      {/* The tab bar pins, the masthead above it scrolls away. Sticking the whole masthead clipped
          the icon, because the icon is pulled up into the banner by `-mt-10` and a sticky box has
          nowhere to put the part that hangs above its own top edge. Pinning the tabs keeps the one
          thing a reader needs at depth — the way between sections — without that problem, and
          without the height-shrinking approach that oscillates. */}
      <div
        className={cn(
          'bg-surface sticky top-0 z-20 mx-auto w-full max-w-7xl px-3 pt-1 pb-2 @2xl:px-6 @4xl:px-8',
          className,
        )}
      >
        {tabs}
      </div>

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 pt-4 pb-[calc(env(safe-area-inset-bottom)+7rem)] lg:pb-[calc(env(safe-area-inset-bottom)+1.5rem)] @2xl:gap-5 @2xl:px-6 @4xl:px-8">
        {children}
      </div>
    </div>
  );
}
