'use client';

/**
 * The loading state for an entity detail page.
 *
 * @remarks
 * Built by rendering the real {@link EntityDetailLayout} with placeholders in its slots, rather
 * than by arranging a stack of grey bars that approximates it. That distinction is the whole
 * point. A hand-drawn placeholder inherits nothing: the detail pages each grew one in a
 * different container from the page it preceded — a couple used the *list* page's container —
 * with no icon, no property row, no tab bar, and none of the header's own scrolling. Content
 * did not so much arrive as jump into place, because the two layouts were never the same layout.
 *
 * Composing the real thing means the page measure, the sticky collapsing header, the identity
 * grid and scroll ownership are not reproduced at all; they are simply used. What is left to
 * decide is only how many placeholders a given entity's metadata row and body should show.
 */
import { Skeleton, SkeletonChip, SkeletonGlyph, SkeletonText } from '@docket/ui/primitives';
import type { JSX } from 'react';

import {
  EntityDetailLayout,
  EntityMetadataItem,
  EntityMetadataRow,
  type EntityMetadataPriority,
} from './entity-detail-layout';

/** Props for {@link EntityDetailSkeleton}. */
export interface EntityDetailSkeletonProps {
  /** How many property chips the metadata row will hold. Defaults to a typical detail page. */
  chipCount?: number | undefined;
  /** How many tabs the tab bar will hold. Defaults to a typical detail page. */
  tabCount?: number | undefined;
  /** Whether the page shows a summary line under its title. */
  hasSubtitle?: boolean | undefined;
  /** Accessible label naming what is loading (e.g. "Loading project"). */
  label: string;
  /**
   * The entity's real name, when it is already known.
   *
   * @remarks
   * A page whose body needs a large aggregate can still know its own name well before that
   * aggregate lands — seeded by the composer that created it, or warmed by the list the reader
   * came from. Showing it is the difference between a page that is loading and a page that gives
   * no sign of what it is.
   */
  title?: string | undefined;
  /** The entity's real one-line summary, when it is already known. */
  subtitle?: string | undefined;
}

/**
 * A detail-page placeholder with the geometry of the page it precedes.
 *
 * @param props - The {@link EntityDetailSkeletonProps}.
 * @returns The placeholder page.
 */
export function EntityDetailSkeleton({
  chipCount = 5,
  tabCount = 4,
  hasSubtitle = true,
  label,
  title,
  subtitle,
}: EntityDetailSkeletonProps): JSX.Element {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="h-full">
      <EntityDetailLayout
        // placeholder: the breadcrumb trail, which names containers the record has not been read
        // from yet.
        eyebrow={<SkeletonText className="w-48" />}
        // placeholder: the entity's icon.
        icon={<SkeletonGlyph />}
        title={
          // placeholder (only when the name is not yet known): the entity's name.
          title ?? <SkeletonText scale="headline" className="w-2/3 max-w-md" />
        }
        subtitle={
          // placeholder (only when the summary is not yet known): the entity's one-line summary.
          subtitle ?? (hasSubtitle ? <SkeletonText className="w-1/2 max-w-sm" /> : undefined)
        }
        metadata={
          <EntityMetadataRow ariaLabel={label}>
            {Array.from({ length: chipCount }, (_, index) => (
              // placeholder: one property whose value is part of the record being read.
              <EntityMetadataItem
                key={index}
                priority={Math.min(index, 7) as EntityMetadataPriority}
              >
                <SkeletonChip />
              </EntityMetadataItem>
            ))}
          </EntityMetadataRow>
        }
        tabs={
          <div className="flex items-center gap-6 pt-1">
            {Array.from({ length: tabCount }, (_, index) => (
              // placeholder: a tab label and its count badge.
              <SkeletonText key={index} className="w-20" />
            ))}
          </div>
        }
      >
        {/* placeholder: the active tab's panel. */}
        <Skeleton className="h-96 w-full rounded-xl" />
      </EntityDetailLayout>
    </div>
  );
}

/** Props for {@link EntityDetailBodySkeleton}. */
export interface EntityDetailBodySkeletonProps {
  /** Accessible label naming what is loading (e.g. "Loading project tasks"). */
  label: string;
}

/**
 * The placeholder for a detail page's body alone.
 *
 * @param props - The {@link EntityDetailBodySkeletonProps}.
 * @returns The placeholder panel.
 *
 * @remarks
 * The common case once an entity's own row is cached: the masthead is real — its name, icon and
 * properties are all in hand — and only the composite feeding the tab panels is still in flight.
 * Covering the whole page then would hide data the reader could already be looking at.
 */
export function EntityDetailBodySkeleton({ label }: EntityDetailBodySkeletonProps): JSX.Element {
  return (
    // placeholder: the active tab's panel, still being assembled from the composite read.
    <Skeleton
      role="status"
      aria-busy="true"
      aria-label={label}
      className="h-96 w-full rounded-xl"
    />
  );
}
