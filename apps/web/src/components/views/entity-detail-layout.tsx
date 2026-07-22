/**
 * `views` — the one canonical entity-detail shell that project / initiative / program detail pages
 * compose.
 *
 * @remarks
 * Every strategic-work detail page used to hand-roll its own masthead: some put the status chip
 * inline with the title, some hid properties behind a popover, some floated them in a right rail,
 * and the title size drifted between surfaces. {@link EntityDetailLayout} fixes the *arrangement*
 * once — identity pair (icon inline-left of the title, subtitle beneath), a metadata slot for the
 * full inline property row, then the tab bar with a separator beneath it and the active panel — so
 * a page only supplies content through slots. The canonical title token
 * (`text-headline-medium font-medium`) is owned here so no page can diverge from it.
 */
import type { JSX, ReactNode } from 'react';

import { Separator } from '@docket/ui/primitives';

import { PageContainer } from './page-layout';

/** Props for {@link EntityDetailLayout}. */
export interface EntityDetailLayoutProps {
  /** A rare band above the masthead — e.g. the Initiative breadcrumb + Print action. */
  eyebrow?: ReactNode;
  /** The entity icon rendered inline-left of the title (an editable picker or a static glyph, ~40px). */
  icon: ReactNode;
  /** The title content (e.g. an inline-editable title); the layout owns the canonical token. */
  title: ReactNode;
  /** The one-line summary rendered directly under the identity pair. */
  subtitle?: ReactNode;
  /** The inline metadata row — typically an {@link EntityMetadataRow} of property pickers. */
  metadata?: ReactNode;
  /** Right-aligned masthead actions (e.g. the ⋯ menu). */
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
 * Renders (top to bottom): the optional eyebrow, a masthead whose identity pair places the icon
 * inline-left of the title with the subtitle beneath and any actions right-aligned, the metadata
 * row, then the tab bar with a separator under it, then the active panel. Status/health and every
 * other property live in the metadata slot, never inline with the title.
 *
 * @param props - The {@link EntityDetailLayoutProps}.
 * @returns the composed detail page.
 */
export function EntityDetailLayout({
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
  return (
    <PageContainer className={className}>
      {eyebrow}
      <header className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-3">
              {icon}
              <h1 className="text-on-surface text-headline-medium max-w-[32ch] min-w-0 font-medium">
                {title}
              </h1>
            </div>
            {subtitle ? (
              <div className="text-on-surface-variant text-body-large max-w-4xl">{subtitle}</div>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </div>
        {metadata}
      </header>
      <div className="flex flex-col gap-2">
        {tabs}
        <Separator />
      </div>
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
