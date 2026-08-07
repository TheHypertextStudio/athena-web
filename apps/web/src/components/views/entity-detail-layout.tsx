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
      <div className="flex w-full flex-col">
        {/* The banner starts at the very top of the pane — a strip of page above it would make it
            a picture in the page rather than the page's header. The eyebrow floats over it in a
            backdrop-blurred pill, which is what keeps a back link legible over artwork nobody
            chose for legibility. */}
        <div className="relative">
          {cover}
          {/* Eyebrow and actions share one row over the banner, matching the row they share when
              there is no banner. Each sits in its own blurred pill, which is what keeps a back
              link and a menu legible over artwork nobody chose for legibility. */}
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
        {/* `relative z-10` is load-bearing, not decoration. The banner above lives in a
            positioned box, and a positioned element paints in a later layer than a non-positioned
            sibling — so without this the banner drew *over* the masthead that overlaps it, and the
            icon's opaque disc was covered by the banner's own edge and watermark. It read exactly
            like a transparency bug and is a paint-order one. */}
        <PageContainer className={cn('relative z-10 -mt-10', className)}>
          <header className="flex flex-col gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              {/* An opaque disc, not just a ring. Every entity glyph paints its tint at ~15%
                  alpha, so straddling the banner let the cover composite straight through the
                  icon; the ring alone only fixed the 4px around it. */}
              <div className="bg-surface ring-surface w-fit shrink-0 rounded-full ring-4">
                {icon}
              </div>
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
          {tabs}
          {children}
        </PageContainer>
      </div>
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
