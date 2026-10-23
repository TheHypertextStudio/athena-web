import { attachment, db, externalResource, initiative, project, task } from '@docket/db';
import { and, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';

import { LibraryRef, type LibrarySummary, type ListResourcesInput } from '../contracts/library';
import type { SearchResult } from '../contracts/search';
import { BillingGraceExpiredError, NotFoundError, ProductRequiredError } from '../error';
import { assertProductCapability } from '../product-capability';
import { searchWorkspace, type SearchCaller } from '../search/query';
import { usedInForPage } from '../search/query-lookups';
import {
  filterVisibleRows,
  resolveCallerAccess,
  type CallerOrgAccess,
} from '../search/query-visibility';
import { scoreLibrarySource, summarizeLibraryResource, type LibrarySource } from './library-source';

interface LibraryEntry {
  ref: LibraryRef;
  source: LibrarySource;
}

/** Browse/search Library material with batched live source and permission checks for each page. */
export async function listLibraryResources(
  caller: SearchCaller,
  input: z.infer<typeof ListResourcesInput>,
): Promise<{
  items: z.infer<typeof LibrarySummary>[];
  nextCursor?: string;
}> {
  const result = await searchWorkspace({
    caller,
    scope: input.orgId ? 'org' : 'hub',
    ...(input.orgId ? { orgId: input.orgId } : {}),
    params: {
      q: input.query,
      kinds: input.kinds.length ? input.kinds : ['external_resource', 'attachment'],
      limit: input.limit,
      ...(input.cursor ? { cursor: input.cursor } : {}),
    },
  });
  const accesses = await entitledAccess(caller, result.items);
  const sources = await currentSources(
    result.items,
    accesses.map((access) => access.organizationId),
  );
  const entries = await activeSubjects(sources);
  const summaries = await visibleSummaries(caller, entries, accesses);
  return {
    items: result.items.flatMap((hit) => {
      const key = `${hit.organizationId}:${hit.kind}:${hit.entityId}`;
      const item = summaries.get(key);
      return item ? [item] : [];
    }),
    ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
  };
}

async function entitledAccess(
  caller: SearchCaller,
  hits: readonly SearchResult[],
): Promise<CallerOrgAccess[]> {
  const organizations = new Set<string | null>(hits.map((hit) => hit.organizationId));
  const accesses = (await resolveCallerAccess(caller)).filter((access) =>
    organizations.has(access.organizationId),
  );
  const allowed = await Promise.all(
    accesses.map(async (access) => {
      try {
        await assertProductCapability(access.organizationId, 'mcp');
        return access;
      } catch (error) {
        if (!(
          error instanceof NotFoundError ||
          error instanceof ProductRequiredError ||
          error instanceof BillingGraceExpiredError
        ))
          throw error;
        return null;
      }
    }),
  );
  return allowed.filter((access) => access !== null);
}

async function currentSources(
  hits: readonly SearchResult[],
  orgIds: string[],
): Promise<LibraryEntry[]> {
  if (orgIds.length === 0) return [];
  const ids = hits.map((hit) => hit.entityId);
  const [links, attachments] = await Promise.all([
    db
      .select()
      .from(externalResource)
      .where(
        and(
          inArray(externalResource.organizationId, orgIds),
          inArray(externalResource.id, ids),
          isNull(externalResource.archivedAt),
        ),
      ),
    db
      .select()
      .from(attachment)
      .where(
        and(
          inArray(attachment.organizationId, orgIds),
          inArray(attachment.id, ids),
          isNull(attachment.archivedAt),
        ),
      ),
  ]);
  return [
    ...links.map((source) => ({
      ref: LibraryRef.parse({
        orgId: source.organizationId,
        kind: 'external_resource',
        id: source.id,
      }),
      source,
    })),
    ...attachments.map((source) => ({
      ref: LibraryRef.parse({ orgId: source.organizationId, kind: 'attachment', id: source.id }),
      source,
    })),
  ];
}

async function activeSubjects(entries: LibraryEntry[]): Promise<LibraryEntry[]> {
  const subjects = await Promise.all(
    (
      [
        ['task', task],
        ['project', project],
        ['initiative', initiative],
      ] as const
    ).map(async ([kind, table]) => {
      const sources = entries.flatMap(({ source }) =>
        'subjectType' in source && source.subjectType === kind ? [source] : [],
      );
      if (sources.length === 0) return [];
      const rows = await db
        .select({ id: table.id, orgId: table.organizationId })
        .from(table)
        .where(
          and(
            inArray(
              table.id,
              sources.map((source) => source.subjectId),
            ),
            inArray(
              table.organizationId,
              sources.map((source) => source.organizationId),
            ),
            isNull(table.archivedAt),
          ),
        );
      return rows.map((row) => `${row.orgId}:${kind}:${row.id}`);
    }),
  );
  const active = new Set(subjects.flat());
  return entries.filter(
    ({ source }) =>
      !('subjectType' in source) ||
      active.has(`${source.organizationId}:${source.subjectType}:${source.subjectId}`),
  );
}

async function visibleSummaries(
  caller: SearchCaller,
  entries: LibraryEntry[],
  accesses: CallerOrgAccess[],
): Promise<Map<string, z.infer<typeof LibrarySummary>>> {
  const scored = await Promise.all(
    entries.map(({ ref, source }) => scoreLibrarySource(ref, source)),
  );
  const visible = await filterVisibleRows(
    scored.map((item) => item.row),
    {
      ownerUserId: caller.kind === 'user' ? caller.userId : null,
      accessByOrg: new Map(accesses.map((access) => [access.organizationId, access])),
    },
  );
  const visibleIds = new Set(visible.rows.map((row) => row.id));
  const usedIn = await usedInForPage(
    scored.filter((item) => visibleIds.has(item.row.id)),
    caller,
  );
  const summaries = new Map<string, z.infer<typeof LibrarySummary>>();
  for (const [index, entry] of entries.entries()) {
    const row = scored[index]?.row;
    if (!row || !visibleIds.has(row.id)) continue;
    const key = `${entry.ref.orgId}:${entry.ref.kind}:${entry.ref.id}`;
    summaries.set(
      key,
      summarizeLibraryResource(entry.ref, entry.source, [...(usedIn.get(row.id) ?? [])]),
    );
  }
  return summaries;
}
