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

import type { NotionColumnBinding, NotionPropertyKind } from '@docket/types';

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
 * What a loader produces: a Notion-ready value, or a person reference still to be resolved.
 *
 * @remarks
 * Deliberately a **wider** type than {@link MirrorValue} rather than a new member of it. Widening
 * only the source side means `projectRow` still takes `MirrorValue`, so any projection path that
 * forgets to resolve is a compile error rather than a silent fall back to the display name — which
 * is exactly the failure this exists to fix. It also keeps `actor` unconstructible on the *pull*
 * side, where it can never legitimately occur.
 */
export type MirrorSourceValue = MirrorValue | MirrorActorValue;

/** The two id maps a person representation needs, loaded once per pass. */
export interface PersonProjection {
  /**
   * `actorId → Notion workspace user id`, for matched people only.
   *
   * @remarks
   * Absence means unmatched — never a guess. Notion's native people property can only reference
   * members of the Notion workspace, so a person with no Notion account is structurally
   * unrepresentable there, and inventing a nearby id would assign somebody else's work.
   */
  readonly notionUserByActor: ReadonlyMap<string, string>;
  /** `actorId → its page id` in Docket's projected People database. */
  readonly personPageByActor: ReadonlyMap<string, string>;
}

/** Why one person reference could not be written. */
export type MirrorUnresolvedReason =
  /** No Notion account to point at. Permanent and by design — the column holds the matched subset. */
  | 'no_notion_account'
  /** The People row is not projected yet. Transient; a later pass fills it. */
  | 'person_page_missing';

/** One person reference a pass could not write, and whether retrying can fix it. */
export interface MirrorUnresolvedRef {
  readonly field: string;
  readonly actorId: string;
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
 * Render every person reference in a row according to its column's representation.
 *
 * @remarks
 * The distinction the rules below turn on is **known-empty versus unknown**, and it is the whole
 * reason this is not a one-liner:
 *
 * - A genuinely absent person (`actorId: null`) resolves to an empty value, which *clears* the
 *   Notion property. That is correct — the assignee really was removed.
 * - A person whose page id is not known *yet* omits the field entirely. `projectRow` skips an
 *   absent value, so it lands in neither the payload nor the content hash, and the next pass
 *   fills it in with exactly one write. Writing an empty value here would look identical to the
 *   first case and would confidently erase a cell somebody may have filled in by hand.
 *
 * @param bindings - The designed columns, which decide each field's Notion kind.
 * @param source - The loader's values, some of which are person references.
 * @param people - The id maps, loaded once per pass.
 * @returns Notion-ready values plus every reference that could not be written.
 */
export function resolveMirrorValues(
  bindings: readonly NotionColumnBinding[],
  source: Readonly<Record<string, MirrorSourceValue>>,
  people: PersonProjection,
): ResolvedMirrorValues {
  const values: Record<string, MirrorValue> = {};
  const unresolved: MirrorUnresolvedRef[] = [];
  const bindingByField = new Map(bindings.map((binding) => [binding.field, binding]));

  for (const [field, value] of Object.entries(source)) {
    if (value.kind !== 'actor') {
      values[field] = value;
      continue;
    }

    const binding = bindingByField.get(field);
    // No column for this field: nothing to render it into, and `projectRow` would drop it anyway.
    if (binding === undefined) continue;
    const kind = provisionedKind(binding);
    const actorId = value.actorId;

    if (kind === 'people') {
      if (actorId === null) {
        values[field] = { kind: 'people', externalIds: [] };
        continue;
      }
      const notionUserId = people.notionUserByActor.get(actorId);
      if (notionUserId === undefined) {
        // Honest empty, not an omission: this column's documented meaning is "the matched subset",
        // and the text column beside it carries the name. Retrying will not change the answer.
        values[field] = { kind: 'people', externalIds: [] };
        unresolved.push({ field, actorId, reason: 'no_notion_account', retryable: false });
        continue;
      }
      values[field] = { kind: 'people', externalIds: [notionUserId] };
      continue;
    }

    if (kind === 'relation') {
      if (actorId === null) {
        values[field] = { kind: 'relation', externalPageIds: [] };
        continue;
      }
      const pageId = people.personPageByActor.get(actorId);
      if (pageId === undefined) {
        // Omitted, NOT cleared — see the remarks. The People row simply has not been written yet.
        unresolved.push({ field, actorId, reason: 'person_page_missing', retryable: true });
        continue;
      }
      values[field] = { kind: 'relation', externalPageIds: [pageId] };
      continue;
    }

    values[field] = { kind: 'text', value: actorId === null ? null : value.displayName };
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
