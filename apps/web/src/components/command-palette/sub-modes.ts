'use client';

/**
 * `components/command-palette/sub-modes` — the command palette's typed prefix mode.
 *
 * @remarks
 * A registry expressed as "call every mode's hook in a loop" cannot exist here — React's rules of
 * hooks forbid a hook call whose presence depends on runtime state (which mode is active). So
 * this stays honest: {@link parsePrefix} is pure and generic, {@link PALETTE_MODES} is pure
 * metadata for rendering the pill/section label, and each mode's item list is its own named hook
 * (only {@link useLabelPaletteMode} today), called unconditionally by `CommandPalette` and
 * selected by `mode`. Adding `>` or `@` later means: one new named hook here, one new
 * `PALETTE_MODES` entry, one new call + switch arm in `CommandPalette` — not a framework.
 */
import { Tag, type LucideIcon } from '@docket/ui/icons';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

import { labelsDef } from '@/components/labels/queries';
import { labelFilterHref } from '@/lib/search-route';
import { userErrorMessage } from '@/lib/problem';
import { useApiListQuery } from '@/lib/query';

import { subsequenceMatch } from './filter';
import type { PaletteItem } from './types';

/** A raw palette query split into its leading mode prefix (if any) and the term after it. */
export interface ParsedPaletteQuery {
  readonly mode: string | null;
  readonly term: string;
}

/** Split `query` on a recognized leading mode prefix. */
export function parsePrefix(query: string): ParsedPaletteQuery {
  if (query.startsWith('#')) return { mode: '#', term: query.slice(1) };
  return { mode: null, term: query };
}

/** Display metadata for a registered mode, keyed by its prefix character. */
export interface PaletteModeMeta {
  readonly label: string;
  readonly icon: LucideIcon;
}

/** Every registered sub-mode's display metadata. */
export const PALETTE_MODES: Record<string, PaletteModeMeta> = {
  '#': { label: 'Labels', icon: Tag },
};

/** What every mode's item-list hook needs from the palette host. */
export interface PaletteModeContext {
  /** The org bound to the palette's route, or `null` on the Hub. */
  readonly activeOrgId: string | null;
  /** Close the palette; a selected row calls this before navigating. */
  readonly close: () => void;
}

/** What every mode's item-list hook returns. */
export interface PaletteModeResult {
  readonly items: readonly PaletteItem[];
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * The `#` mode's item list: every org label matching `term`, each navigating to the task list
 * pre-filtered to it.
 *
 * @remarks
 * Labels are org-scoped and the palette can be in Hub scope with no bound org — that case returns
 * no items and issues no request rather than fanning out across every membership, so the caller
 * can show its own "open a workspace" copy instead of a bare empty list.
 */
export function useLabelPaletteMode(
  term: string,
  { activeOrgId, close }: PaletteModeContext,
): PaletteModeResult {
  const router = useRouter();
  const enabled = activeOrgId !== null;
  const labelsQ = useApiListQuery({ ...labelsDef(activeOrgId ?? ''), enabled });

  const items = useMemo<readonly PaletteItem[]>(() => {
    if (!enabled) return [];
    const orgId = activeOrgId;
    const q = term.trim().toLowerCase();
    const allLabels = labelsQ.data?.items ?? [];
    return allLabels
      .filter((label) => subsequenceMatch(label.name, q))
      .map((label) => ({
        id: `label-mode:${label.id}`,
        section: 'results' as const,
        label: label.name,
        icon: Tag,
        run: () => {
          close();
          router.push(labelFilterHref(orgId, label.id));
        },
      }));
  }, [enabled, term, labelsQ.data, close, router, activeOrgId]);

  return {
    items,
    loading: enabled && labelsQ.isPending,
    error:
      enabled && labelsQ.isError
        ? userErrorMessage(labelsQ.error, 'Could not load your labels.')
        : null,
  };
}
