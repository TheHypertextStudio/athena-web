'use client';

/**
 * What a detail page's slots can read about where they sit: the page's own object, and whether a
 * metadata item's copy is the visible one.
 *
 * @remarks
 * Provided by `EntityDetailLayout` and `EntityMetadataItem` (`entity-detail-layout.tsx`). Content
 * that anchors a floating card to itself, such as the Created row's origin card, reads these to
 * find its entity and to open the metadata row's overflow when its visible copy lives there.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { ObjectRef } from '@/lib/actions/object';

/** Where one metadata item is on screen, read by content that must anchor to it. */
export interface EntityMetadataPlacement {
  /** Whether this copy of the item is hidden (an inline copy that lives in the overflow). */
  readonly hidden: boolean;
  /** Open the overflow so the item's visible copy mounts, or `null` when nothing can. */
  readonly reveal: (() => void) | null;
}

/** A metadata lane that can open its row's overflow. */
export interface OverflowRevealer {
  /** Open the row's overflow popover, where a hidden item's visible copy renders. */
  readonly revealOverflow?: (() => void) | undefined;
}

const VISIBLE_PLACEMENT: EntityMetadataPlacement = { hidden: false, reveal: null };

/** The placement of the enclosing metadata item. */
export const MetadataPlacementContext = createContext<EntityMetadataPlacement>(VISIBLE_PLACEMENT);

/**
 * Read where the enclosing metadata item is on screen.
 *
 * @remarks
 * Content outside a metadata row (a sidebar row, a footer) always reads as visible.
 *
 * @returns the item's placement.
 */
export function useEntityMetadataPlacement(): EntityMetadataPlacement {
  return useContext(MetadataPlacementContext);
}

/**
 * Build a metadata item's placement.
 *
 * @param hidden - Whether this copy is hidden in the inline lane.
 * @param lane - The lane the copy renders in, or `null` outside a metadata row.
 * @returns a stable placement value.
 */
export function useMetadataItemPlacement(
  hidden: boolean,
  lane: OverflowRevealer | null,
): EntityMetadataPlacement {
  const reveal = hidden ? (lane?.revealOverflow ?? null) : null;
  return useMemo(() => ({ hidden, reveal }), [hidden, reveal]);
}

/** A metadata row's overflow popover, opened by a person or by content that must be seen. */
export interface OverflowDisclosure {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  /** Open the overflow. */
  readonly reveal: () => void;
}

/**
 * Hold a metadata row's overflow open state.
 *
 * @returns the state, its setter, and a stable `reveal`.
 */
export function useOverflowDisclosure(): OverflowDisclosure {
  const [open, setOpen] = useState(false);
  const reveal = useCallback(() => {
    setOpen(true);
  }, []);
  return { open, setOpen, reveal };
}

/** The object the enclosing detail page is for. */
export const EntityDetailObjectContext = createContext<ObjectRef | null>(null);

/**
 * Read the object the enclosing `EntityDetailLayout` is the page for.
 *
 * @returns the page's object, or `null` outside a layout or in one given no `object`.
 */
export function useEntityDetailObject(): ObjectRef | null {
  return useContext(EntityDetailObjectContext);
}
