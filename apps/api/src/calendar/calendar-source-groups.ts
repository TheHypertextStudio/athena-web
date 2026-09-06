import { createHash } from 'node:crypto';

import {
  calendarLayer,
  calendarList,
  calendarSourceGroup,
  calendarSourceGroupMember,
  type Database,
} from '@docket/db';
import type {
  CalendarLayerOut,
  CalendarSourceGroupOut,
  CalendarSourceGroupSuggestionOut,
  CalendarSourceGroupUpdate,
} from '@docket/planning/calendar-contract';
import {
  canonicalizeCalendarLayers,
  groupExactCalendarSources,
} from '@docket/planning/calendar-canonicalization';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';

import { NotFoundError, ValidationError } from '../error';
import { toCalendarLayerOut } from './calendar-serializers';

interface LogicalSourceGroupModel {
  readonly output: z.input<typeof CalendarSourceGroupOut>;
  readonly layerIds: readonly string[];
}

type ActiveCalendarLayerOut = z.input<typeof CalendarLayerOut> & {
  sourceIdentity: NonNullable<z.input<typeof CalendarLayerOut>['sourceIdentity']> | null;
  sourceRelationship: NonNullable<z.input<typeof CalendarLayerOut>['sourceRelationship']> | null;
};

function derivedGroupId(prefix: 'exact' | 'layer', key: string): string {
  const digest = createHash('sha256').update(key).digest('base64url').slice(0, 22);
  return `${prefix}_${digest}`;
}

function preferredLayer(
  layers: readonly ActiveCalendarLayerOut[],
  preferredLayerId: string | null,
): ActiveCalendarLayerOut {
  const stored = layers.find((layer) => layer.id === preferredLayerId);
  const selected = stored ?? canonicalizeCalendarLayers(layers).layers[0];
  if (!selected) throw new Error('Logical calendar group has no active source.');
  return selected;
}

function toGroupOutput(
  id: string,
  persistedGroupId: string | null,
  provenance: 'single' | 'exact' | 'confirmed',
  layers: readonly ActiveCalendarLayerOut[],
  storedPreferredLayerId: string | null,
): LogicalSourceGroupModel {
  const preferred = preferredLayer(layers, storedPreferredLayerId);
  return {
    layerIds: layers.map((layer) => layer.id),
    output: {
      id,
      persistedGroupId,
      provenance,
      title: preferred.title,
      color: preferred.color,
      selected: layers.some((layer) => layer.selected),
      visibleByDefault: layers.some((layer) => layer.visibleByDefault),
      preferredLayerId: preferred.id,
      sources: layers.map((layer) => ({
        layerId: layer.id,
        connectionId: layer.connectionId,
        relationship: layer.sourceRelationship ?? null,
        management: layer.sourceManagement ?? {
          canRemoveSubscription: false,
          requiresIncrementalConsent: false,
        },
      })),
    },
  };
}

async function readActiveLayerOutputs(
  db: Database,
  userId: string,
): Promise<ActiveCalendarLayerOut[]> {
  const rows = await db
    .select()
    .from(calendarLayer)
    .where(and(eq(calendarLayer.userId, userId), isNull(calendarLayer.removedAt)));
  return rows.map((row) => {
    const layer = toCalendarLayerOut(row);
    return {
      ...layer,
      sourceIdentity: layer.sourceIdentity ?? null,
      sourceRelationship: layer.sourceRelationship ?? null,
    };
  });
}

async function readConfirmedMemberships(
  db: Database,
  userId: string,
): Promise<
  readonly {
    groupId: string;
    preferredLayerId: string | null;
    layerId: string;
  }[]
> {
  return db
    .select({
      groupId: calendarSourceGroup.id,
      preferredLayerId: calendarSourceGroup.preferredLayerId,
      layerId: calendarSourceGroupMember.layerId,
    })
    .from(calendarSourceGroupMember)
    .innerJoin(calendarSourceGroup, eq(calendarSourceGroup.id, calendarSourceGroupMember.groupId))
    .where(eq(calendarSourceGroup.userId, userId));
}

async function buildLogicalSourceGroupModels(
  db: Database,
  userId: string,
): Promise<readonly LogicalSourceGroupModel[]> {
  const [layers, memberships] = await Promise.all([
    readActiveLayerOutputs(db, userId),
    readConfirmedMemberships(db, userId),
  ]);
  const layerById = new Map(layers.map((layer) => [layer.id, layer]));
  const groupedLayerIds = new Set<string>();
  const models: LogicalSourceGroupModel[] = [];
  const membershipsByGroup = new Map<string, typeof memberships>();
  for (const membership of memberships) {
    const current = membershipsByGroup.get(membership.groupId) ?? [];
    membershipsByGroup.set(membership.groupId, [...current, membership]);
  }
  for (const [groupId, groupMemberships] of membershipsByGroup) {
    const groupLayers = groupMemberships.flatMap((membership) => {
      const layer = layerById.get(membership.layerId);
      return layer ? [layer] : [];
    });
    if (groupLayers.length === 0) continue;
    for (const layer of groupLayers) groupedLayerIds.add(layer.id);
    models.push(
      toGroupOutput(
        groupId,
        groupId,
        'confirmed',
        groupLayers,
        groupMemberships[0]?.preferredLayerId ?? null,
      ),
    );
  }

  const remaining = layers.filter((layer) => !groupedLayerIds.has(layer.id));
  for (const exactGroup of groupExactCalendarSources(remaining)) {
    const groupLayers = exactGroup.layerIds.flatMap((id) => {
      const layer = layerById.get(id);
      return layer ? [layer] : [];
    });
    if (groupLayers.length === 0) continue;
    const exact = groupLayers.length > 1;
    models.push(
      toGroupOutput(
        derivedGroupId(exact ? 'exact' : 'layer', exactGroup.key),
        null,
        exact ? 'exact' : 'single',
        groupLayers,
        null,
      ),
    );
  }
  return models.sort((left, right) => left.output.title.localeCompare(right.output.title));
}

/** Read every logical calendar group and unconfirmed provider suggestion for settings. */
export async function readCalendarSourceGroups(
  db: Database,
  userId: string,
): Promise<{
  sourceGroups: z.input<typeof CalendarSourceGroupOut>[];
  sourceGroupSuggestions: z.input<typeof CalendarSourceGroupSuggestionOut>[];
}> {
  const models = await buildLogicalSourceGroupModels(db, userId);
  const layers = await readActiveLayerOutputs(db, userId);
  const groupIdByLayerId = new Map(
    models.flatMap((model) => model.layerIds.map((layerId) => [layerId, model.output.id] as const)),
  );
  const bySuggestion = new Map<string, ActiveCalendarLayerOut[]>();
  for (const layer of layers) {
    if (!layer.suggestedGroupKey) continue;
    const current = bySuggestion.get(layer.suggestedGroupKey) ?? [];
    current.push(layer);
    bySuggestion.set(layer.suggestedGroupKey, current);
  }
  const sourceGroupSuggestions = [...bySuggestion].flatMap(([key, candidates]) => {
    if (candidates.length < 2) return [];
    const currentGroups = new Set(candidates.map((layer) => groupIdByLayerId.get(layer.id)));
    if (currentGroups.size === 1) return [];
    return [
      { key, title: candidates[0]?.title ?? 'Calendar', layerIds: candidates.map((l) => l.id) },
    ];
  });
  return { sourceGroups: models.map((model) => model.output), sourceGroupSuggestions };
}

/** Map each active source layer to the preferred source for canonical reads. */
export async function readPreferredCalendarLayerMap(
  db: Database,
  userId: string,
): Promise<ReadonlyMap<string, string>> {
  const models = await buildLogicalSourceGroupModels(db, userId);
  return new Map(
    models.flatMap((model) =>
      model.layerIds.map((layerId) => [layerId, model.output.preferredLayerId] as const),
    ),
  );
}

async function requireLogicalGroup(
  db: Database,
  userId: string,
  groupId: string,
): Promise<LogicalSourceGroupModel> {
  const group = (await buildLogicalSourceGroupModels(db, userId)).find(
    (candidate) => candidate.output.id === groupId,
  );
  if (!group) throw new NotFoundError('Calendar group not found');
  return group;
}

/** Confirm a set of active user-owned layers as one logical calendar. */
export async function createCalendarSourceGroup(
  db: Database,
  input: { userId: string; layerIds: readonly string[]; preferredLayerId: string },
): Promise<void> {
  const uniqueLayerIds = [...new Set(input.layerIds)];
  if (uniqueLayerIds.length < 2 || !uniqueLayerIds.includes(input.preferredLayerId)) {
    throw new ValidationError([
      { path: ['layerIds'], message: 'Choose at least two valid sources' },
    ]);
  }
  const ownedLayers = await db
    .select({ id: calendarLayer.id })
    .from(calendarLayer)
    .where(
      and(
        eq(calendarLayer.userId, input.userId),
        inArray(calendarLayer.id, uniqueLayerIds),
        isNull(calendarLayer.removedAt),
      ),
    );
  if (ownedLayers.length !== uniqueLayerIds.length) throw new NotFoundError('Calendar not found');
  const assigned = await db
    .select({ layerId: calendarSourceGroupMember.layerId })
    .from(calendarSourceGroupMember)
    .where(inArray(calendarSourceGroupMember.layerId, uniqueLayerIds));
  if (assigned.length > 0) {
    throw new ValidationError([
      { path: ['layerIds'], message: 'A source already belongs to a group' },
    ]);
  }
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(calendarSourceGroup)
      .values({ userId: input.userId, preferredLayerId: input.preferredLayerId })
      .returning({ id: calendarSourceGroup.id });
    const group = inserted[0];
    if (!group) throw new Error('Calendar group insert returned no row.');
    await tx
      .insert(calendarSourceGroupMember)
      .values(uniqueLayerIds.map((layerId) => ({ groupId: group.id, layerId })));
  });
}

/** Update preferred source or visibility for one logical calendar. */
export async function updateCalendarSourceGroup(
  db: Database,
  input: { userId: string; groupId: string; patch: z.infer<typeof CalendarSourceGroupUpdate> },
): Promise<void> {
  const group = await requireLogicalGroup(db, input.userId, input.groupId);
  if (
    input.patch.preferredLayerId !== undefined &&
    !group.layerIds.includes(input.patch.preferredLayerId)
  ) {
    throw new ValidationError([
      { path: ['preferredLayerId'], message: 'The preferred source must belong to the group' },
    ]);
  }
  await db.transaction(async (tx) => {
    const persistedGroupId = group.output.persistedGroupId;
    if (input.patch.preferredLayerId !== undefined && persistedGroupId === null) {
      const inserted = await tx
        .insert(calendarSourceGroup)
        .values({ userId: input.userId, preferredLayerId: input.patch.preferredLayerId })
        .returning({ id: calendarSourceGroup.id });
      const newGroupId = inserted[0]?.id;
      if (!newGroupId) throw new Error('Calendar group insert returned no row.');
      await tx
        .insert(calendarSourceGroupMember)
        .values(group.layerIds.map((layerId) => ({ groupId: newGroupId, layerId })));
    } else if (input.patch.preferredLayerId !== undefined && persistedGroupId !== null) {
      await tx
        .update(calendarSourceGroup)
        .set({ preferredLayerId: input.patch.preferredLayerId })
        .where(
          and(
            eq(calendarSourceGroup.id, persistedGroupId),
            eq(calendarSourceGroup.userId, input.userId),
          ),
        );
    }
    const visibility = {
      ...(input.patch.selected === undefined ? {} : { selected: input.patch.selected }),
      ...(input.patch.visibleByDefault === undefined
        ? {}
        : { visibleByDefault: input.patch.visibleByDefault }),
    };
    if (Object.keys(visibility).length === 0) return;
    await tx.update(calendarLayer).set(visibility).where(inArray(calendarLayer.id, group.layerIds));
    await tx.update(calendarList).set(visibility).where(inArray(calendarList.id, group.layerIds));
  });
}

/** Separate a confirmed logical calendar while preserving every physical source. */
export async function deleteCalendarSourceGroup(
  db: Database,
  userId: string,
  groupId: string,
): Promise<void> {
  const deleted = await db
    .delete(calendarSourceGroup)
    .where(and(eq(calendarSourceGroup.id, groupId), eq(calendarSourceGroup.userId, userId)))
    .returning({ id: calendarSourceGroup.id });
  if (!deleted[0]) throw new NotFoundError('Calendar group not found');
}
