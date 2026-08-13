/**
 * `@docket/integrations` — projecting a Docket value into a Notion property value. Pure.
 *
 * @remarks
 * The other half of `./notion-mirror-schema`: that module says what a column *is*, this one says
 * what goes *in* it. Kept separate from the HTTP edge so every mapping is unit-testable, and kept
 * pure so the content hash is a function of the values alone — which is what makes "skip the write
 * when nothing changed" trustworthy.
 *
 * Notion's per-request limits are enforced here rather than discovered as a 400: rich text is
 * capped at 2000 characters and a relation at 100 targets. Both truncate **and say so**, because
 * a sync that silently drops the tail of a description is worse than one that admits it.
 */
import { createHash } from 'node:crypto';

import type { NotionColumnBinding, NotionMirrorEntity, NotionPropertyKind } from '@docket/types';

import { NOTION_RELATION_LIMIT, NOTION_TEXT_LIMIT } from './notion-mirror';
import { provisionedKind } from './notion-mirror-schema';

/** A Docket value on its way into Notion. */
export type MirrorValue =
  | { readonly kind: 'text'; readonly value: string | null }
  | { readonly kind: 'number'; readonly value: number | null }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'date'; readonly value: string | null }
  | { readonly kind: 'option'; readonly value: string | null }
  | { readonly kind: 'people'; readonly externalIds: readonly string[] }
  | { readonly kind: 'relation'; readonly externalPageIds: readonly string[] }
  | { readonly kind: 'url'; readonly value: string | null };

/**
 * A reference to a Docket person, before a representation decides how it is written.
 *
 * @remarks
 * A person-valued field is the one kind whose Notion payload is not a function of the Docket value
 * alone: the same assignee is a name, a native Notion person, or a relation to a People row
 * depending on what the column was designed as. Resolving that needs two id maps the loader has no
 * business knowing about, so the loader emits this and {@link resolveMirrorValues} renders it.
 *
 * `displayName` rides along because the `text` representation — the default, and the only one that
 * can hold a person with no Notion account — needs nothing else.
 */
export interface MirrorActorValue {
  readonly kind: 'actor';
  readonly actorId: string | null;
  readonly displayName: string | null;
}

/**
 * A reference to other Docket records, before their Notion page ids are known.
 *
 * @remarks
 * The relation counterpart to {@link MirrorActorValue}, and it exists for the same reason: a
 * relation column's payload is page ids in somebody else's database, which a loader reading one
 * table has no way to know. The loader states *what* is referenced; {@link resolveMirrorValues}
 * turns that into ids once the pass has projected the target.
 *
 * `entity` rides along because the binding does not carry it — {@link NotionColumnBinding} is the
 * stored column, and which entity it points at is a fact about the catalog. Naming it here keeps
 * the resolver from having to know which entity owns the row it is rendering.
 *
 * `entityIds` is a set, not one id, because Notion relations are to-many and several Docket fields
 * genuinely are (a task's labels, a team's members). A to-one field simply carries at most one.
 */
export interface MirrorReferenceValue {
  readonly kind: 'reference';
  readonly entity: NotionMirrorEntity;
  readonly entityIds: readonly string[];
}

/**
 * What a loader produces: a Notion-ready value, or a reference still to be resolved.
 *
 * @remarks
 * Deliberately a **wider** type than {@link MirrorValue} rather than a new member of it. Widening
 * only the source side means `projectRow` still takes `MirrorValue`, so any projection path that
 * forgets to resolve is a compile error rather than a silent fall back to the display name — which
 * is exactly the failure this exists to fix. It also keeps `actor` and `reference` unconstructible
 * on the *pull* side, where neither can legitimately occur.
 */
export type MirrorSourceValue = MirrorValue | MirrorActorValue | MirrorReferenceValue;

/** What a pass knows about one target entity's projected pages. */
export interface MirrorEntityPages {
  /** `entityId → Notion page id`, for the rows projected so far. */
  readonly pageByEntityId: ReadonlyMap<string, string>;
  /**
   * Whether this entity is finished projecting, so a missing page is final rather than pending.
   *
   * @remarks
   * The distinction that keeps a workspace from being permanently "not fully synced". Once an
   * entity has been projected to completion, an id with no page is one its loader does not
   * project at all — an archived record, or a team member who is an agent rather than a person —
   * and no amount of retrying will produce one.
   *
   * False while the entity is still ahead in the pass (a back edge in the dependency graph), or
   * when its own projection stopped early on the write budget.
   */
  readonly settled: boolean;
}

/** Everything a pass needs to turn references into Notion ids, loaded once and advanced as it runs. */
export interface MirrorReferences {
  /**
   * `actorId → Notion workspace user id`, for matched people only.
   *
   * @remarks
   * Absence means unmatched — never a guess. Notion's native people property can only reference
   * members of the Notion workspace, so a person with no Notion account is structurally
   * unrepresentable there, and inventing a nearby id would assign somebody else's work.
   */
  readonly notionUserByActor: ReadonlyMap<string, string>;
  /**
   * Projected pages per entity.
   *
   * @remarks
   * An entity with **no entry at all** is not being projected — its database is disabled or was
   * never provisioned — so references to it can never resolve and are permanent, not pending.
   *
   * The People database is in here like any other, keyed by actor id, because the `person`
   * entity's own record id *is* the actor id. That is what lets one map serve both the person
   * representations and every ordinary relation.
   */
  readonly pages: ReadonlyMap<NotionMirrorEntity, MirrorEntityPages>;
}

/** Why one reference could not be written. */
export type MirrorUnresolvedReason =
  /** No Notion account to point at. Permanent and by design — the column holds the matched subset. */
  | 'no_notion_account'
  /** The People row is not projected yet. Transient; a later pass fills it. */
  | 'person_page_missing'
  /** The related record's page is not projected yet. Transient; a later pass fills it. */
  | 'related_page_missing'
  /** The related record is not projected at all, so no page will ever exist for it. */
  | 'related_page_impossible';

/** One reference a pass could not write, and whether retrying can fix it. */
export interface MirrorUnresolvedRef {
  readonly field: string;
  /** The Docket id that did not resolve — an actor for a person column, a record for a relation. */
  readonly targetId: string;
  readonly reason: MirrorUnresolvedReason;
  /** True when a later pass can resolve it; false when nothing will change by retrying. */
  readonly retryable: boolean;
}

/** Values ready for {@link projectRow}, plus what could not be resolved. */
export interface ResolvedMirrorValues {
  readonly values: Readonly<Record<string, MirrorValue>>;
  readonly unresolved: readonly MirrorUnresolvedRef[];
}

/**
 * Render one person reference according to its column's representation.
 *
 * @param field - The column being rendered, for the unresolved report.
 * @param value - The actor reference.
 * @param kind - The Notion type the column is provisioned as.
 * @param refs - The pass's id maps.
 * @param unresolved - Collector for anything that could not be written.
 * @returns the Notion value, or undefined to omit the field entirely.
 */
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
      // Honest empty, not an omission: this column's documented meaning is "the matched subset",
      // and the text column beside it carries the name. Retrying will not change the answer.
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
    // Settled (or absent) means no People page will appear for this actor — they are an agent, a
    // team, or archived, none of which the People database projects. Cleared honestly rather than
    // omitted forever, which would leave the pass permanently incomplete.
    if (people === undefined || people.settled) {
      unresolved.push({
        field,
        targetId: actorId,
        reason: 'related_page_impossible',
        retryable: false,
      });
      return { kind: 'relation', externalPageIds: [] };
    }
    // Omitted, NOT cleared — see the remarks. The People row simply has not been written yet.
    unresolved.push({ field, targetId: actorId, reason: 'person_page_missing', retryable: true });
    return undefined;
  }

  return { kind: 'text', value: actorId === null ? null : value.displayName };
}

/**
 * Render one relation reference into the page ids it points at.
 *
 * @remarks
 * A partially resolvable set is the case worth stating. If any member's page is merely *not
 * written yet*, the whole field is omitted: writing the subset would look complete in Notion while
 * silently dropping the rest, and the next pass fills it in whole. But once the target is settled,
 * missing members are ones that will never have a page, so the resolvable remainder is written —
 * "everyone we can represent", the same contract the native people column already keeps.
 *
 * @param field - The column being rendered, for the unresolved report.
 * @param value - The reference to resolve.
 * @param refs - The pass's id maps.
 * @param unresolved - Collector for anything that could not be written.
 * @returns the Notion value, or undefined to omit the field entirely.
 */
function resolveReference(
  field: string,
  value: MirrorReferenceValue,
  kind: NotionPropertyKind,
  refs: MirrorReferences,
  unresolved: MirrorUnresolvedRef[],
): MirrorValue | undefined {
  // Page ids are meaningless in any other property type. A binding whose stored `kind` disagrees
  // with the catalog — legacy data, a hand-edited property map — would otherwise fall into
  // `propertyValue`'s text branch and `stringify` would write the raw Notion UUIDs into a
  // rich-text cell. Omitting leaves the column untouched instead.
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
    // No entry at all means the target database is disabled or unprovisioned, so nothing will
    // ever create these pages; settled means this particular record is not one the target
    // projects. Either way retrying is pointless, and saying so is what lets a pass finish.
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
 * Render every reference in a row into the ids Notion needs.
 *
 * @remarks
 * The distinction the rules turn on is **known-empty versus unknown**, and it is the whole reason
 * this is not a one-liner:
 *
 * - A genuinely absent target (no assignee, no labels) resolves to an empty value, which *clears*
 *   the Notion property. That is correct — the relation really was removed.
 * - A target whose page is not known *yet* omits the field entirely. `projectRow` skips an absent
 *   value, so it lands in neither the payload nor the content hash, and the next pass fills it in
 *   with exactly one write. Writing an empty value here would look identical to the first case and
 *   would confidently erase a cell somebody may have filled in by hand.
 * - A target that will *never* have a page resolves to an empty value too, and is reported as
 *   non-retryable. Deferring it forever would keep the pass from ever completing, which is how a
 *   single agent on a team could stop a workspace recording a full sync.
 *
 * @param bindings - The designed columns, which decide each field's Notion kind.
 * @param source - The loader's values, some of which are references.
 * @param refs - The pass's id maps, advanced as each entity is projected.
 * @returns Notion-ready values plus every reference that could not be written.
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
    // No column for this field: nothing to render it into, and `projectRow` would drop it anyway.
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

/** Something dropped to stay inside a Notion limit. */
export interface MirrorTruncation {
  readonly field: string;
  readonly limit: 'text' | 'relation';
  /** How many characters or targets were dropped. */
  readonly dropped: number;
}

/** The outcome of projecting one row. */
export interface ProjectedRow {
  /** The Notion `properties` payload, keyed by property id. */
  readonly properties: Record<string, unknown>;
  /** A stable hash of the projected values — the "did anything change" key. */
  readonly contentHash: string;
  /** Anything trimmed to fit a Notion limit, so the caller can report it. */
  readonly truncations: readonly MirrorTruncation[];
}

/** Wrap a string as Notion's rich-text array shape. */
function richText(value: string): { text: { content: string } }[] {
  return value.length === 0 ? [] : [{ text: { content: value } }];
}

/**
 * Render one Docket value as the Notion property payload for its binding.
 *
 * @remarks
 * Addressed by **property id**, never by title — a rename on either side must not move where a
 * value lands. Returns `undefined` for a binding Notion has no property for yet (an unprovisioned
 * column), so a partially provisioned database writes what it can rather than failing whole.
 *
 * @param binding - The designed column.
 * @param value - The Docket value.
 * @param truncations - Collector for anything trimmed to fit a limit.
 * @returns the `[propertyId, payload]` pair, or undefined when the column is not provisioned.
 */
export function propertyValue(
  binding: NotionColumnBinding,
  value: MirrorValue,
  truncations: MirrorTruncation[],
): readonly [string, unknown] | undefined {
  const propertyId = binding.propertyId;
  if (propertyId === undefined) return undefined;
  const kind = provisionedKind(binding);

  switch (kind) {
    case 'title':
    case 'rich_text': {
      const raw = value.kind === 'text' ? (value.value ?? '') : stringify(value);
      const clipped = raw.slice(0, NOTION_TEXT_LIMIT);
      if (clipped.length < raw.length) {
        truncations.push({
          field: binding.field,
          limit: 'text',
          dropped: raw.length - clipped.length,
        });
      }
      return [
        propertyId,
        kind === 'title' ? { title: richText(clipped) } : { rich_text: richText(clipped) },
      ];
    }
    case 'number':
      return [propertyId, { number: value.kind === 'number' ? value.value : null }];
    case 'checkbox':
      return [propertyId, { checkbox: value.kind === 'boolean' ? value.value : false }];
    case 'date':
      return [
        propertyId,
        { date: value.kind === 'date' && value.value !== null ? { start: value.value } : null },
      ];
    case 'url':
      return [propertyId, { url: value.kind === 'url' ? value.value : null }];
    case 'email':
      return [propertyId, { email: value.kind === 'text' ? value.value : null }];
    case 'select':
    case 'status': {
      const name = value.kind === 'option' ? value.value : null;
      const payload = name === null || name.length === 0 ? null : { name };
      return [propertyId, kind === 'select' ? { select: payload } : { status: payload }];
    }
    case 'multi_select': {
      const names = value.kind === 'option' && value.value ? [value.value] : [];
      return [propertyId, { multi_select: names.map((name) => ({ name })) }];
    }
    case 'people': {
      const ids = value.kind === 'people' ? value.externalIds : [];
      return [propertyId, { people: ids.map((id) => ({ object: 'user', id })) }];
    }
    case 'relation': {
      const all = value.kind === 'relation' ? value.externalPageIds : [];
      const kept = all.slice(0, NOTION_RELATION_LIMIT);
      if (kept.length < all.length) {
        truncations.push({
          field: binding.field,
          limit: 'relation',
          dropped: all.length - kept.length,
        });
      }
      return [propertyId, { relation: kept.map((id) => ({ id })) }];
    }
  }
}

/** Shape of a rich-text/title Notion property value, narrowed just enough to read `plain_text`. */
interface RichTextLike {
  readonly plain_text?: unknown;
}

/** Best-effort read of Notion's rich-text array shape back into a plain string. */
function readRichText(raw: unknown): string {
  if (!Array.isArray(raw)) return '';
  return raw
    .map((item) => {
      const text = (item as RichTextLike | undefined)?.plain_text;
      return typeof text === 'string' ? text : '';
    })
    .join('');
}

/**
 * Parse one raw Notion property value back into a {@link MirrorValue}.
 *
 * @remarks
 * The inverse of {@link propertyValue}. Returns `undefined` for a property kind this reader does
 * not (yet) turn into a Docket value — `people` and `relation` are read as raw ids here even
 * though nothing currently applies them (see `notion-mirror-entities.ts`'s deliberately narrower
 * pull scope), so the parser stays complete even where the applier is not.
 *
 * @param kind - The column's representation, from its binding.
 * @param raw - The property value Notion returned, keyed by its own `type` field.
 * @returns the parsed value, or undefined when the raw shape does not match the expected kind.
 */
export function parseMirrorValue(kind: NotionPropertyKind, raw: unknown): MirrorValue | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const record = raw as Record<string, unknown>;

  switch (kind) {
    case 'title':
      return { kind: 'text', value: readRichText(record['title']) || null };
    case 'rich_text':
      return { kind: 'text', value: readRichText(record['rich_text']) || null };
    case 'email': {
      const value = record['email'];
      return { kind: 'text', value: typeof value === 'string' ? value : null };
    }
    case 'number': {
      const value = record['number'];
      return { kind: 'number', value: typeof value === 'number' ? value : null };
    }
    case 'checkbox': {
      const value = record['checkbox'];
      return { kind: 'boolean', value: value === true };
    }
    case 'date': {
      const date = record['date'];
      const start =
        typeof date === 'object' && date !== null ? (date as { start?: unknown }).start : undefined;
      return { kind: 'date', value: typeof start === 'string' ? start.slice(0, 10) : null };
    }
    case 'url': {
      const value = record['url'];
      return { kind: 'url', value: typeof value === 'string' ? value : null };
    }
    case 'select': {
      const select = record['select'];
      const name =
        typeof select === 'object' && select !== null
          ? (select as { name?: unknown }).name
          : undefined;
      return { kind: 'option', value: typeof name === 'string' ? name : null };
    }
    case 'status': {
      const status = record['status'];
      const name =
        typeof status === 'object' && status !== null
          ? (status as { name?: unknown }).name
          : undefined;
      return { kind: 'option', value: typeof name === 'string' ? name : null };
    }
    case 'multi_select': {
      const options = record['multi_select'];
      const first = Array.isArray(options)
        ? (options[0] as { name?: unknown } | undefined)
        : undefined;
      return { kind: 'option', value: typeof first?.name === 'string' ? first.name : null };
    }
    case 'people': {
      const people = record['people'];
      const ids = Array.isArray(people)
        ? people
            .map((p) => (p as { id?: unknown } | undefined)?.id)
            .filter((id): id is string => typeof id === 'string')
        : [];
      return { kind: 'people', externalIds: ids };
    }
    case 'relation': {
      const relation = record['relation'];
      const ids = Array.isArray(relation)
        ? relation
            .map((r) => (r as { id?: unknown } | undefined)?.id)
            .filter((id): id is string => typeof id === 'string')
        : [];
      return { kind: 'relation', externalPageIds: ids };
    }
  }
}

/**
 * Read a Notion page's raw properties back into Docket field values, keyed by field.
 *
 * @remarks
 * Matched by **property id**, never by the name Notion's `page.properties` map happens to be
 * keyed by today — the same rename-safety reason bindings are stored by id in the first place. A
 * binding whose id is not present on the page (a column added to the design since this page was
 * last read, or one Notion has not finished provisioning) is silently absent from the result
 * rather than treated as an explicit null, so a caller cannot mistake "not read yet" for "cleared".
 *
 * @param bindings - The designed columns.
 * @param rawProperties - `MirrorChange.properties`, as Notion returned them.
 * @returns Docket values for every binding Notion actually reported.
 */
export function readMirrorProperties(
  bindings: readonly NotionColumnBinding[],
  rawProperties: Readonly<Record<string, unknown>>,
): Record<string, MirrorValue> {
  const byPropertyId = new Map<string, unknown>();
  for (const raw of Object.values(rawProperties)) {
    const id = (raw as { id?: unknown } | undefined)?.id;
    if (typeof id === 'string') byPropertyId.set(id, raw);
  }

  const values: Record<string, MirrorValue> = {};
  for (const binding of bindings) {
    if (binding.propertyId === undefined) continue;
    const raw = byPropertyId.get(binding.propertyId);
    if (raw === undefined) continue;
    const value = parseMirrorValue(provisionedKind(binding), raw);
    if (value !== undefined) values[binding.field] = value;
  }
  return values;
}

/** Best-effort string for a value being written into a text column. */
function stringify(value: MirrorValue): string {
  switch (value.kind) {
    case 'text':
    case 'date':
    case 'option':
    case 'url':
      return value.value ?? '';
    case 'number':
      return value.value === null ? '' : String(value.value);
    case 'boolean':
      return value.value ? 'Yes' : 'No';
    case 'people':
      return value.externalIds.join(', ');
    case 'relation':
      return value.externalPageIds.join(', ');
  }
}

/**
 * Project one Docket record into a Notion page payload.
 *
 * @remarks
 * The content hash covers the **projected** values, not the Docket record: an entity whose
 * `updated_at` moved for a reason this database does not carry (a comment, an unrelated field)
 * hashes identically and costs no Notion write. At roughly three requests a second, that is the
 * difference between a sweep that keeps up and one that does not.
 *
 * Hashed from a sorted key list so the digest does not depend on object iteration order, which
 * jsonb does not preserve anyway.
 *
 * @param bindings - The designed columns.
 * @param values - The Docket values, keyed by field.
 * @returns the Notion payload, its hash, and anything trimmed to fit a limit.
 */
export function projectRow(
  bindings: readonly NotionColumnBinding[],
  values: Readonly<Record<string, MirrorValue>>,
): ProjectedRow {
  const truncations: MirrorTruncation[] = [];
  const properties: Record<string, unknown> = {};
  const hashParts: string[] = [];

  for (const binding of [...bindings].sort((a, b) => a.field.localeCompare(b.field))) {
    const value = values[binding.field];
    if (value === undefined) continue;
    const entry = propertyValue(binding, value, truncations);
    if (entry === undefined) continue;
    properties[entry[0]] = entry[1];
    hashParts.push(`${binding.field}=${JSON.stringify(entry[1])}`);
  }

  return {
    properties,
    contentHash: createHash('sha256').update(hashParts.join(' ')).digest('hex').slice(0, 32),
    truncations,
  };
}
