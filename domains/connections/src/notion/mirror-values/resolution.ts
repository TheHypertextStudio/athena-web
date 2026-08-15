/**
 * Resolve Docket actor and relation references into the ids Notion can write.
 *
 * Unknown targets are intentionally distinguished from known-empty targets: unknown fields are
 * omitted so a later pass can converge, while known-empty fields clear their Notion property.
 */
import type { NotionColumnBinding, NotionPropertyKind } from '../mirror-contract';

import { provisionedKind } from '../mirror-schema';
import type {
  MirrorActorValue,
  MirrorReferences,
  MirrorReferenceValue,
  MirrorSourceValue,
  MirrorUnresolvedRef,
  MirrorValue,
  ResolvedMirrorValues,
} from './contracts';

/** Resolve one actor according to the kind provisioned for its column. */
function resolveActor(
  field: string,
  value: MirrorActorValue,
  kind: NotionPropertyKind,
  refs: MirrorReferences,
  unresolved: MirrorUnresolvedRef[],
): MirrorValue | undefined {
  const actorId = value.actorId;
  if (kind === 'people') {
    if (actorId === null) return { kind: 'people', externalIds: [] };
    const notionUserId = refs.notionUserByActor.get(actorId);
    if (notionUserId === undefined) {
      unresolved.push({ field, targetId: actorId, reason: 'no_notion_account', retryable: false });
      return { kind: 'people', externalIds: [] };
    }
    return { kind: 'people', externalIds: [notionUserId] };
  }

  if (kind === 'relation') {
    if (actorId === null) return { kind: 'relation', externalPageIds: [] };
    const people = refs.pages.get('person');
    const pageId = people?.pageByEntityId.get(actorId);
    if (pageId !== undefined) return { kind: 'relation', externalPageIds: [pageId] };
    if (people === undefined || people.settled) {
      unresolved.push({
        field,
        targetId: actorId,
        reason: 'related_page_impossible',
        retryable: false,
      });
      return { kind: 'relation', externalPageIds: [] };
    }
    unresolved.push({ field, targetId: actorId, reason: 'person_page_missing', retryable: true });
    return undefined;
  }

  return { kind: 'text', value: actorId === null ? null : value.displayName };
}

/**
 * Resolve a relation reference.
 *
 * A partially-resolved relation is omitted as a whole while its target is still being projected;
 * writing only the known subset would silently discard the remainder.
 */
function resolveReference(
  field: string,
  value: MirrorReferenceValue,
  kind: NotionPropertyKind,
  refs: MirrorReferences,
  unresolved: MirrorUnresolvedRef[],
): MirrorValue | undefined {
  if (kind !== 'relation') return undefined;
  const target = refs.pages.get(value.entity);
  const externalPageIds: string[] = [];
  const deferred: MirrorUnresolvedRef[] = [];
  const impossible: MirrorUnresolvedRef[] = [];

  for (const entityId of value.entityIds) {
    const pageId = target?.pageByEntityId.get(entityId);
    if (pageId !== undefined) {
      externalPageIds.push(pageId);
      continue;
    }
    if (target === undefined || target.settled) {
      impossible.push({
        field,
        targetId: entityId,
        reason: 'related_page_impossible',
        retryable: false,
      });
      continue;
    }
    deferred.push({ field, targetId: entityId, reason: 'related_page_missing', retryable: true });
  }

  if (deferred.length > 0) {
    unresolved.push(...deferred, ...impossible);
    return undefined;
  }
  unresolved.push(...impossible);
  return { kind: 'relation', externalPageIds };
}

/**
 * Resolve actor and relation references into Notion-ready values.
 *
 * The returned values omit only unresolved references that could appear later. Explicit nulls
 * remain values, allowing property projection to clear a removed relation or person.
 */
export function resolveMirrorValues(
  bindings: readonly NotionColumnBinding[],
  source: Readonly<Record<string, MirrorSourceValue>>,
  refs: MirrorReferences,
): ResolvedMirrorValues {
  const values: Record<string, MirrorValue> = {};
  const unresolved: MirrorUnresolvedRef[] = [];
  const bindingByField = new Map(bindings.map((binding) => [binding.field, binding]));

  for (const [field, value] of Object.entries(source)) {
    if (value.kind !== 'actor' && value.kind !== 'reference') {
      values[field] = value;
      continue;
    }

    const binding = bindingByField.get(field);
    if (binding === undefined) continue;
    const kind = provisionedKind(binding);
    const resolved =
      value.kind === 'actor'
        ? resolveActor(field, value, kind, refs, unresolved)
        : resolveReference(field, value, kind, refs, unresolved);
    if (resolved !== undefined) values[field] = resolved;
  }

  return { values, unresolved };
}
