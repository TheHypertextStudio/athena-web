'use client';

/**
 * `stream` — the source-attribution chip (a brand-colored dot + provider name).
 *
 * @remarks
 * Heterogeneous events render through one homogeneous row; the source is shown here as a small
 * badge, not a per-source layout. Telling Linear from GitHub from Docket at a glance is the
 * badge's whole job, which is what earns it colour on an otherwise ≥90%-neutral surface.
 *
 * The brand colours live in `packages/ui/src/styles/globals.css` under `[data-provider]`, not
 * here. This badge names a key and the stylesheet owns what that key means — the same split
 * `LabelChip` uses, and for a reason that was a live bug rather than a preference: the inline
 * hex this replaces could not respond to a theme change, so GitHub's near-black brand ink
 * rendered an invisible dot on every dark surface in the product.
 */
import { PROVIDER_CATALOG } from '@docket/connections/provider-catalog-contract';
import { type SourceSystemKind } from '@docket/connections/event-contract';
import { Badge } from '@docket/ui/primitives';
import type { JSX } from 'react';

const SOURCE_LABELS = Object.fromEntries(
  Object.values(PROVIDER_CATALOG).flatMap((entry) =>
    entry.sourceSystem ? [[entry.sourceSystem, entry.name]] : [],
  ),
);

/** Props for {@link ProviderBadge}. */
export interface ProviderBadgeProps {
  /** The source system (`docket` | `linear` | `github` | `google_calendar` | `gmail`). */
  readonly system: SourceSystemKind;
}

/** A compact source-attribution badge for one stream event. */
export function ProviderBadge({ system }: ProviderBadgeProps): JSX.Element {
  const label = system === 'docket' ? 'Docket' : (SOURCE_LABELS[system] ?? system);
  return (
    <Badge variant="outline" data-provider={system} className="gap-1.5">
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-(--provider-dot)" />
      {label}
    </Badge>
  );
}
