'use client';

import { getOrgAccent } from '@docket/ui/lib/org-accent';
import type { CSSProperties, JSX } from 'react';

/** Props for {@link OrgChip}. */
export interface OrgChipProps {
  /** The org the chip identifies. */
  orgId: string;
  /** The org's display name. */
  name: string;
}

/**
 * A compact org identifier chip: the org's accent dot plus its name.
 *
 * @remarks
 * Used to attribute cross-org rows on the Hub (e.g. a `today` task) to their originating
 * organization. The leading dot reuses the design system's deterministic per-org accent
 * (`getOrgAccent`) so the same org reads consistently here and in the rail.
 */
export function OrgChip({ orgId, name }: OrgChipProps): JSX.Element {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: getOrgAccent(orgId) } as CSSProperties}
      />
      <span className="truncate">{name}</span>
    </span>
  );
}
