'use client';

/**
 * The customized icons the connected-work tree draws its Projects and Programs with.
 *
 * @remarks
 * A Project's identity is the glyph and colour someone chose for it, which is what its own detail
 * masthead paints. A list that falls back to the generic kind glyph makes every Project look the
 * same as every other one, and makes this tab the only place in the product where a Project does
 * not look like itself.
 *
 * Read as two workspace-wide lists rather than one request per row: the rosters are small, they
 * are shared with every other surface that draws these glyphs, and a row appearing or being
 * created does not cost another round trip.
 */
import { defaultEntityDisplay, type EntityDisplayOut } from '@docket/work/entity-display-contract';
import { useMemo } from 'react';

import { api } from '@/lib/api';
import { fetchAllEntityDisplays } from '@/lib/org-collection-pages';
import { apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';

/**
 * Resolve one row's display record.
 *
 * @remarks
 * Never null. An entity nobody has customized still has an identity — the kind's own glyph and a
 * colour derived from its id — and it still belongs in the same tinted container as one that has
 * been customized. Falling back to a bare icon instead is what made half the tree's rows look
 * like loose glyphs sitting next to their titles.
 */
export type ConnectedWorkDisplayLookup = (
  kind: 'program' | 'project',
  id: string,
) => EntityDisplayOut;

/**
 * Read the workspace's Project and Program display records.
 *
 * @param orgId - The workspace whose rosters to read.
 * @param enabled - Whether the tab is showing; false leaves both reads unissued.
 * @returns A lookup that answers the kind's derived default until a stored record arrives, so a
 *   row renders its real identity mark immediately rather than holding the list back.
 */
export function useConnectedWorkDisplays(
  orgId: string,
  enabled: boolean,
): ConnectedWorkDisplayLookup {
  const projects = useApiQuery(
    apiQueryOptions(
      queryKeys.entityDisplays(orgId, 'project'),
      () => fetchAllEntityDisplays(api, orgId, 'project'),
      'Could not load project icons.',
      { enabled },
    ),
  );
  const programs = useApiQuery(
    apiQueryOptions(
      queryKeys.entityDisplays(orgId, 'program'),
      () => fetchAllEntityDisplays(api, orgId, 'program'),
      'Could not load program icons.',
      { enabled },
    ),
  );

  return useMemo<ConnectedWorkDisplayLookup>(() => {
    const byKey = new Map<string, EntityDisplayOut>();
    for (const display of projects.data?.items ?? [])
      byKey.set(`project:${display.subjectId}`, display);
    for (const display of programs.data?.items ?? [])
      byKey.set(`program:${display.subjectId}`, display);
    return (kind, id) => byKey.get(`${kind}:${id}`) ?? defaultEntityDisplay(kind, id);
  }, [projects.data, programs.data]);
}
