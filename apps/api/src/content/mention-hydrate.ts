/**
 * Resolve references into the cards a chip's hovercard renders.
 *
 * @remarks
 * Batched per surface rather than per chip: a description with six mentions must cost one request,
 * not six. The cap is enforced by the DTO.
 *
 * Two properties matter more than anything else here.
 *
 * Visibility is re-checked at read time even though the reconciler already refused cross-tenant
 * references at write time. The two gates protect against different things: the write gate stops a
 * forged reference from ever creating an edge, and this one stops a legitimately-written reference
 * from continuing to reveal a title after the reader's grant is revoked.
 *
 * An inaccessible entity returns `accessible: false` and *nothing else*. Not a blanked title, not
 * a placeholder — no field at all, because a card that renders "Restricted task" still confirms
 * that the id names something real.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { MentionCard, MentionRef } from '@docket/types';
import { canonicalizeResourceUrl, mentionRefKey } from '@docket/types';

import { loadVisibleDocuments, type SearchCaller } from '../search/query';

import { toExternalResourceOut, type ExternalResourceRow } from './resource-view';

/** Route an entity ref to its in-app href. */
function hrefFor(orgId: string, ref: Extract<MentionRef, { kind: 'entity' }>): string {
  const base = `/orgs/${orgId}`;
  switch (ref.entityKind) {
    case 'task':
      return `${base}/tasks/${ref.entityId}`;
    case 'project':
      return `${base}/projects/${ref.entityId}`;
    case 'program':
      return `${base}/programs/${ref.entityId}`;
    case 'initiative':
      return `${base}/initiatives/${ref.entityId}`;
    case 'cycle':
      return `${base}/cycles/${ref.entityId}`;
    case 'milestone':
      return `${base}/milestones/${ref.entityId}`;
    case 'team':
      return `${base}/teams/${ref.entityId}`;
    case 'actor':
      return `${base}/members/${ref.entityId}`;
    case 'agent_session':
      return `${base}/sessions/${ref.entityId}`;
    case 'comment':
    case 'update':
      return `${base}/activity/${ref.entityId}`;
  }
}

/** A card for an entity the caller may not see: the id, and nothing that describes it. */
function inaccessibleCard(ref: Extract<MentionRef, { kind: 'entity' }>): MentionCard {
  return {
    kind: 'entity',
    entityKind: ref.entityKind,
    entityId: ref.entityId,
    accessible: false,
    title: null,
    subtitle: null,
    href: null,
    state: null,
    health: null,
    ownerLabel: null,
    dueAt: null,
    updatedAt: null,
  };
}

/** Load the visible index rows for a batch of entity refs, keyed by entity id. */
async function loadVisibleEntities(
  caller: SearchCaller,
  orgId: string,
  refs: readonly Extract<MentionRef, { kind: 'entity' }>[],
): Promise<Map<string, { title: string; summary: string | null; updatedAt: Date | null }>> {
  if (refs.length === 0) return new Map();
  const rows = await loadVisibleDocuments({
    caller,
    orgId,
    entityIds: refs.map((ref) => ref.entityId),
  });
  return new Map(
    rows.map((row) => [
      row.entityId,
      { title: row.title, summary: row.summary, updatedAt: row.sourceUpdatedAt },
    ]),
  );
}

/** Load the shared resource rows behind a batch of external refs. */
async function loadResources(
  orgId: string,
  refs: readonly Extract<MentionRef, { kind: 'external' }>[],
): Promise<Map<string, ExternalResourceRow>> {
  if (refs.length === 0) return new Map();
  const schema = await import('@docket/db');

  const byKey = new Map<string, string>();
  for (const ref of refs) {
    const canonical = canonicalizeResourceUrl(ref.url);
    if (canonical !== undefined) byKey.set(canonical.canonicalKey, ref.url);
  }
  if (byKey.size === 0) return new Map();

  const rows = await schema.db
    .select()
    .from(schema.externalResource)
    .where(
      and(
        eq(schema.externalResource.organizationId, orgId),
        inArray(schema.externalResource.canonicalKey, [...byKey.keys()]),
      ),
    );

  const out = new Map<string, ExternalResourceRow>();
  for (const row of rows) {
    const url = byKey.get(row.canonicalKey);
    if (url !== undefined) out.set(url, row);
  }
  return out;
}

/**
 * Resolve a batch of references into preview cards.
 *
 * @param input - The caller, the org, and the refs a rendered surface needs cards for.
 * @returns One card per resolvable ref, in request order. Refs we cannot resolve are omitted.
 */
export async function hydrateMentions(input: {
  caller: SearchCaller;
  orgId: string;
  refs: readonly MentionRef[];
}): Promise<MentionCard[]> {
  const entityRefs = input.refs.filter(
    (ref): ref is Extract<MentionRef, { kind: 'entity' }> => ref.kind === 'entity',
  );
  const externalRefs = input.refs.filter(
    (ref): ref is Extract<MentionRef, { kind: 'external' }> => ref.kind === 'external',
  );

  const [entities, resources] = await Promise.all([
    loadVisibleEntities(input.caller, input.orgId, entityRefs),
    loadResources(input.orgId, externalRefs),
  ]);

  const seen = new Set<string>();
  const cards: MentionCard[] = [];
  for (const ref of input.refs) {
    const key = mentionRefKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);

    if (ref.kind === 'entity') {
      const found = entities.get(ref.entityId);
      if (found === undefined) {
        cards.push(inaccessibleCard(ref));
        continue;
      }
      cards.push({
        kind: 'entity',
        entityKind: ref.entityKind,
        entityId: ref.entityId,
        accessible: true,
        title: found.title,
        subtitle: found.summary,
        href: hrefFor(input.orgId, ref),
        state: null,
        health: null,
        ownerLabel: null,
        dueAt: null,
        updatedAt: found.updatedAt?.toISOString() ?? null,
      });
      continue;
    }

    const row = resources.get(ref.url);
    if (row === undefined) continue;
    cards.push({ kind: 'external', url: ref.url, resource: toExternalResourceOut(row) });
  }
  return cards;
}
