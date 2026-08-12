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

import { ObjectSurface } from '@/components/objects/object-surface';
import type { ObjectRef } from '@/lib/actions/object';

import { useDetailHeaderCollapse } from './entity-detail-collapse';

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
  /** Canonical object identity for drag and the shared right-click action surface. */
  object?: ObjectRef;
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
  object,
}: EntityDetailLayoutProps): JSX.Element {
  // Every detail page owns its scrolling, backdrop or not. Making it conditional would mean two
  // layouts again — one that scrolls itself and one the shell scrolls — which is the duplication
  // this component exists to remove. It is also required for a backdrop: the shell's `<main>`
  // reserves a permanent scrollbar gutter while it scrolls, and no child of a gutter-reserving box
  // can reach the pane's edge. Owning the scroll additionally gives the header something to pin to
  // and a timeline to collapse against, which every detail page benefits from equally.
  useOwnPageScroll();
  const scrollRef = useDetailHeaderCollapse({ hasCover: Boolean(cover) });

  const header = (
    <header className="page-bleed page-grid bg-surface sticky top-0 isolate z-10 gap-y-0 pt-1 pb-1">
      {/* The backdrop is a layer of this header, not a section above it. `isolate` traps it in
          the header's own stacking context, so it cannot paint over anything outside — the class
          of bug that made an opaque icon look transparent. It has no height of its own: it is
          whatever the header is, so collapsing the header collapses the artwork with it. */}
      {cover ? <div className="absolute inset-0 -z-10 overflow-hidden">{cover}</div> : null}

      {eyebrow || actions ? (
        <div className="mb-3 flex items-center justify-between gap-3 pt-3">
          <div className="min-w-0">{eyebrow}</div>
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </div>
      ) : null}

      {cover ? <div aria-hidden="true" className="detail-backdrop-space" /> : null}

      <div className="detail-masthead">
        <div className="detail-identity">
          <div className="detail-glyph">{icon}</div>
          <h1 className="detail-title text-on-surface text-headline-medium min-w-0 font-medium">
            {title}
          </h1>
        </div>

        <div className="detail-secondary">
          <div className="flex min-w-0 flex-col gap-3">
            {subtitle ? (
              <div className="text-on-surface-variant text-body-large min-w-0">{subtitle}</div>
            ) : null}
            {metadata}
          </div>
        </div>
      </div>

      <div className="detail-tabs">{tabs}</div>
    </header>
  );

  return (
    <div
      ref={scrollRef}
      data-detail-panel-scroll=""
      data-detail-cover={cover ? 'present' : 'absent'}
      className={cn(
        // Sections are rows of this grid, so the rhythm between them is declared once here rather
        // than by each section spacing itself against its neighbours.
        'page-grid h-full min-h-0 w-full gap-y-4 overflow-y-auto pb-24 lg:pb-6 @2xl:gap-y-5',
        className,
      )}
    >
      {/* Bleeds the full pane so the backdrop can reach both edges, and re-measures its own
          children through the nested grid, so nothing inside has to know it sits in a bleeding
          section. */}
      {object ? (
        <ObjectSurface object={object} surfaceId="entity-detail">
          {header}
        </ObjectSurface>
      ) : (
        header
      )}

      {/* This nested grid preserves the page measure while guaranteeing enough stable block-size
          for the scroll-linked header to reach its compact endpoint on short panels. */}
      <div className="detail-body page-bleed page-grid gap-y-4 @2xl:gap-y-5">{children}</div>
    </div>
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
