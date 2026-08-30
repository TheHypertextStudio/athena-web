'use client';

/**
 * `work-views/row-identity` — one leading mark per kind of work, shared by every lens.
 *
 * @remarks
 * The List lens owned this privately, so the Cards lens had nothing to draw and rendered an empty
 * `size-6` spacer where a glyph would go — a placeholder holding open a column for a mark that
 * was never coming. Sharing it means a Project wears its chosen icon and a Task its status ring
 * whichever lens you are looking at, and the selection checkbox has a consistent place to land.
 */
import { defaultEntityDisplay } from '@docket/types';
import { IdentityGlyph } from '@docket/ui/components';
import { Layers } from '@docket/ui/icons';
import type { ViewTarget } from '@docket/work/view-contract';
import type { JSX } from 'react';

import { EntityIconGlyph } from '@/components/entity-display/entity-icon-glyph';
import type { useWorkStatusResolver } from '@/components/entity-display/use-work-status';
import { WorkStatusIcon } from '@/components/entity-display/work-status';

import type { WorkViewRowFor } from './renderer-types';

/** Props for {@link RowIdentity}. */
export interface RowIdentityProps {
  /** The row to mark. */
  readonly row: WorkViewRowFor<ViewTarget>;
  /** The workspace's status resolver, which names a Task's ring. */
  readonly statusOf: ReturnType<typeof useWorkStatusResolver>;
  /**
   * The mark's diameter in pixels. Defaults to the 32px a dense roster row uses.
   *
   * @remarks
   * A card is not a row: it has room for a larger mark, and needs one to balance a title set two
   * steps up the scale. One rule — rows at 32, cards at 40 — rather than a size per target.
   */
  readonly size?: number | undefined;
}

/**
 * The leading identity mark for one row of work.
 *
 * @remarks
 * Projects and Initiatives carry a chosen icon and colour, so they get theirs. A Task's identity
 * is where it stands, so it gets its status ring. A Program has no per-entity glyph to choose —
 * its identity is an ongoing responsibility, not a mark — so it takes the same fixed `Layers`
 * circle the nav and the empty state already use, rather than faking a picker over a field that
 * does not exist.
 *
 * @param props - The {@link RowIdentityProps}.
 */
export function RowIdentity({ row, statusOf, size = 32 }: RowIdentityProps): JSX.Element {
  if (row.target === 'project' || row.target === 'initiative') {
    const display = row.display ?? defaultEntityDisplay(row.target, row.id);
    return (
      <EntityIconGlyph
        iconKey={display.iconKey}
        colorKey={display.colorKey}
        customColor={display.customColor}
        size={size}
      />
    );
  }
  if (row.target === 'program') {
    return (
      <IdentityGlyph size={size}>
        <Layers className="size-4" />
      </IdentityGlyph>
    );
  }
  const status = statusOf(row.status);
  return (
    <IdentityGlyph size={size}>
      <WorkStatusIcon name={status.name} category={status.category} />
    </IdentityGlyph>
  );
}
