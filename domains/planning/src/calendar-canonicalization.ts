/** Provider identity fields needed by shared calendar canonicalization. */
export interface CanonicalCalendarIdentity {
  /** Adapter-owned identity namespace. */
  readonly namespace: string;
  /** Opaque provider value. Shared code compares it byte for byte. */
  readonly value: string;
}

/** Calendar-layer fields needed to select a canonical source. */
export interface CanonicalizableCalendarLayer {
  /** Stable Docket layer id. */
  readonly id: string;
  /** Exact provider source identity, or null for local and unmigrated layers. */
  readonly sourceIdentity: CanonicalCalendarIdentity | null;
  /** How the connected account relates to this source. */
  readonly sourceRelationship: 'owned' | 'direct' | 'shared' | 'subscribed' | null;
  /** Whether the provider marks this layer as the account's primary calendar. */
  readonly primary: boolean;
}

/** Linked-task identity fields used when equivalent event copies carry different Docket metadata. */
export interface CanonicalizableLinkedTask {
  /** Linked task id. */
  readonly taskId: string;
  /** Workspace that owns the link. */
  readonly organizationId: string;
  /** Role that the linked task plays for the event. */
  readonly role: string;
}

/** Calendar-item fields needed to select and merge a canonical occurrence. */
export interface CanonicalizableCalendarItem {
  /** Stable Docket item id. */
  readonly id: string;
  /** Docket layer containing this provider copy. */
  readonly layerId: string;
  /** Exact provider event identity, or null when the adapter cannot prove one. */
  readonly eventIdentity: CanonicalCalendarIdentity | null;
  /** Recurring occurrence discriminator, or null for a non-recurring event. */
  readonly occurrenceIdentity: string | null;
  /** Permission fields that affect canonical-source selection. */
  readonly permissions: { readonly canEditCore: boolean };
  /** Docket task links attached to this provider copy. */
  readonly linkedTasks: readonly CanonicalizableLinkedTask[];
}

/** One exact provider-source group. */
export interface ExactCalendarSourceGroup {
  /** Stable key made from the adapter namespace and opaque value. */
  readonly key: string;
  /** Layer ids in their input order. */
  readonly layerIds: readonly string[];
}

/** Optional user preferences that override derived canonical-source selection. */
export interface CalendarCanonicalizationOptions {
  /** Preferred layer id keyed by every member layer id in its logical source group. */
  readonly preferredLayerIdByLayerId?: ReadonlyMap<string, string>;
}

/** Canonical layer list and the preferred source selected for every input layer. */
export interface CanonicalizedCalendarLayers<TLayer extends CanonicalizableCalendarLayer> {
  /** One selected layer per exact provider source. */
  readonly layers: readonly TLayer[];
  /** Selected layer id keyed by every input member layer id. */
  readonly preferredLayerIdByLayerId: ReadonlyMap<string, string>;
}

/** Canonical event list and the source-copy ids represented by each returned item. */
export interface CanonicalizedCalendarItems<TItem extends CanonicalizableCalendarItem> {
  /** One selected item per exact event occurrence. */
  readonly items: readonly TItem[];
  /** Equivalent source item ids keyed by the selected item's id. */
  readonly equivalentItemIds: ReadonlyMap<string, readonly string[]>;
}

function identityKey(identity: CanonicalCalendarIdentity): string {
  return `${identity.namespace}\0${identity.value}`;
}

/** Group layers only when an adapter emitted the same exact source identity. */
export function groupExactCalendarSources(
  layers: readonly CanonicalizableCalendarLayer[],
): readonly ExactCalendarSourceGroup[] {
  const groups = new Map<string, string[]>();
  for (const layer of layers) {
    const key = layer.sourceIdentity ? identityKey(layer.sourceIdentity) : `local\0${layer.id}`;
    const existing = groups.get(key);
    if (existing) existing.push(layer.id);
    else groups.set(key, [layer.id]);
  }
  return [...groups].map(([key, layerIds]) => ({ key, layerIds }));
}

function relationshipRank(layer: CanonicalizableCalendarLayer | undefined): number {
  if (layer?.sourceRelationship === 'owned') return 2;
  if (layer?.sourceRelationship === 'direct') return 1;
  return 0;
}

function preferredLayers(
  layers: readonly CanonicalizableCalendarLayer[],
  explicit: ReadonlyMap<string, string> | undefined,
): ReadonlyMap<string, string> {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const result = new Map<string, string>();
  for (const group of groupExactCalendarSources(layers)) {
    const explicitLayer = group.layerIds.map((id) => explicit?.get(id)).find(Boolean);
    const preferred =
      explicitLayer ??
      [...group.layerIds].sort((leftId, rightId) => {
        const left = byId.get(leftId);
        const right = byId.get(rightId);
        const relationship = relationshipRank(right) - relationshipRank(left);
        if (relationship !== 0) return relationship;
        const primary = Number(right?.primary === true) - Number(left?.primary === true);
        return primary !== 0 ? primary : leftId.localeCompare(rightId);
      })[0];
    if (!preferred) continue;
    for (const layerId of group.layerIds) result.set(layerId, preferred);
  }
  return result;
}

/** Select one renderable layer for every exact provider-source identity. */
export function canonicalizeCalendarLayers<TLayer extends CanonicalizableCalendarLayer>(
  layers: readonly TLayer[],
  options: CalendarCanonicalizationOptions = {},
): CanonicalizedCalendarLayers<TLayer> {
  const preferredLayerIdByLayerId = preferredLayers(layers, options.preferredLayerIdByLayerId);
  const selected = layers.filter((layer) => preferredLayerIdByLayerId.get(layer.id) === layer.id);
  return { layers: selected, preferredLayerIdByLayerId };
}

function itemIdentityKey(item: CanonicalizableCalendarItem): string | null {
  if (!item.eventIdentity) return null;
  return `${identityKey(item.eventIdentity)}\0${item.occurrenceIdentity ?? ''}`;
}

function candidateBeats(
  candidate: CanonicalizableCalendarItem,
  held: CanonicalizableCalendarItem,
  layersById: ReadonlyMap<string, CanonicalizableCalendarLayer>,
  preferredLayerByLayerId: ReadonlyMap<string, string>,
): boolean {
  const candidatePreferred = preferredLayerByLayerId.get(candidate.layerId) === candidate.layerId;
  const heldPreferred = preferredLayerByLayerId.get(held.layerId) === held.layerId;
  if (candidatePreferred !== heldPreferred) return candidatePreferred;
  if (candidate.permissions.canEditCore !== held.permissions.canEditCore) {
    return candidate.permissions.canEditCore;
  }
  const candidateLayer = layersById.get(candidate.layerId);
  const heldLayer = layersById.get(held.layerId);
  const relationship = relationshipRank(candidateLayer) - relationshipRank(heldLayer);
  if (relationship !== 0) return relationship > 0;
  if (candidateLayer?.primary !== heldLayer?.primary) return candidateLayer?.primary === true;
  return candidate.layerId < held.layerId;
}

function mergeLinkedTasks<TItem extends CanonicalizableCalendarItem>(
  items: readonly TItem[],
): TItem['linkedTasks'] {
  const merged = new Map<string, TItem['linkedTasks'][number]>();
  for (const item of items) {
    for (const link of item.linkedTasks) {
      const key = `${link.organizationId}\0${link.taskId}\0${link.role}`;
      if (!merged.has(key)) merged.set(key, link);
    }
  }
  return [...merged.values()];
}

function createCalendarItemBucket<TItem>(buckets: TItem[][]): TItem[] {
  const bucket: TItem[] = [];
  buckets.push(bucket);
  return bucket;
}

function bucketCalendarItems<TItem extends CanonicalizableCalendarItem>(
  items: readonly TItem[],
): readonly TItem[][] {
  const bucketByKey = new Map<string, TItem[]>();
  const buckets: TItem[][] = [];
  for (const item of items) {
    const key = itemIdentityKey(item);
    const existing = key ? bucketByKey.get(key) : undefined;
    const bucket =
      existing?.every((candidate) => candidate.layerId !== item.layerId) === true
        ? existing
        : createCalendarItemBucket(buckets);
    bucket.push(item);
    if (key && !bucketByKey.has(key)) bucketByKey.set(key, bucket);
  }
  return buckets;
}

function selectCanonicalBucket<TItem extends CanonicalizableCalendarItem>(
  bucket: readonly TItem[],
  layersById: ReadonlyMap<string, CanonicalizableCalendarLayer>,
  preferredLayerByLayerId: ReadonlyMap<string, string>,
): TItem | null {
  const first = bucket[0];
  if (!first) return null;
  const selected = bucket
    .slice(1)
    .reduce(
      (held, candidate) =>
        candidateBeats(candidate, held, layersById, preferredLayerByLayerId) ? candidate : held,
      first,
    );
  return { ...selected, linkedTasks: mergeLinkedTasks(bucket) };
}

function orderCanonicalItems<TItem extends CanonicalizableCalendarItem>(
  items: readonly TItem[],
  canonicalByInputItemId: ReadonlyMap<string, TItem>,
): readonly TItem[] {
  const seen = new Set<string>();
  const canonicalItems: TItem[] = [];
  for (const item of items) {
    const canonical = canonicalByInputItemId.get(item.id);
    if (!canonical || seen.has(canonical.id)) continue;
    seen.add(canonical.id);
    canonicalItems.push(canonical);
  }
  return canonicalItems;
}

/** Collapse exact event occurrences and retain the best source plus all Docket task links. */
export function canonicalizeCalendarItems<TItem extends CanonicalizableCalendarItem>(
  items: readonly TItem[],
  layers: readonly CanonicalizableCalendarLayer[],
  options: CalendarCanonicalizationOptions = {},
): CanonicalizedCalendarItems<TItem> {
  const layersById = new Map(layers.map((layer) => [layer.id, layer]));
  const preferredLayerByLayerId = preferredLayers(layers, options.preferredLayerIdByLayerId);
  const buckets = bucketCalendarItems(items);
  const canonicalByInputItemId = new Map<string, TItem>();
  const equivalentItemIds = new Map<string, readonly string[]>();
  for (const bucket of buckets) {
    const canonical = selectCanonicalBucket(bucket, layersById, preferredLayerByLayerId);
    if (!canonical) continue;
    for (const member of bucket) canonicalByInputItemId.set(member.id, canonical);
    equivalentItemIds.set(
      canonical.id,
      bucket.map((member) => member.id),
    );
  }

  return { items: orderCanonicalItems(items, canonicalByInputItemId), equivalentItemIds };
}
