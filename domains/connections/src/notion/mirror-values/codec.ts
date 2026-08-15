/**
 * Convert Notion mirror values to and from provider payload shapes.
 *
 * This code is deliberately provider-SDK-free: it owns Docket's stable projection rules, while
 * the adapter only transports the resulting payload.
 */
import { createHash } from 'node:crypto';

import type { NotionColumnBinding, NotionPropertyKind } from '../mirror-contract';

import { provisionedKind } from '../mirror-schema';
import type { MirrorTruncation, MirrorValue, ProjectedRow } from './contracts';

/** Notion's rich-text/title content ceiling. */
export const NOTION_TEXT_LIMIT = 2000;

/** Notion's per-request relation target ceiling. */
export const NOTION_RELATION_LIMIT = 100;

/** Wrap a string in Notion's rich-text array shape. */
function richText(value: string): { text: { content: string } }[] {
  return value.length === 0 ? [] : [{ text: { content: value } }];
}

/** Turn any mirror value into a safe text fallback. */
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
 * Render one Docket value as the property payload for its provisioned binding.
 *
 * Bindings are addressed by immutable Notion property id. An unprovisioned binding returns
 * undefined so a partially provisioned mirror writes the rest of its row safely.
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

/** Shape narrowed just enough to read a rich-text run's plain text. */
interface RichTextLike {
  readonly plain_text?: unknown;
}

/** Read Notion's rich-text array shape into plain text. */
function readRichText(raw: unknown): string {
  if (!Array.isArray(raw)) return '';
  return raw
    .map((item) => {
      const text = (item as RichTextLike | undefined)?.plain_text;
      return typeof text === 'string' ? text : '';
    })
    .join('');
}

/** Parse a raw Notion property into the corresponding Docket value. */
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
            .map((person) => (person as { id?: unknown } | undefined)?.id)
            .filter((id): id is string => typeof id === 'string')
        : [];
      return { kind: 'people', externalIds: ids };
    }
    case 'relation': {
      const relation = record['relation'];
      const ids = Array.isArray(relation)
        ? relation
            .map((reference) => (reference as { id?: unknown } | undefined)?.id)
            .filter((id): id is string => typeof id === 'string')
        : [];
      return { kind: 'relation', externalPageIds: ids };
    }
  }
}

/** Read a Notion page's raw properties into Docket field values using property ids. */
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

/**
 * Project one Docket record into a Notion page payload and a stable content hash.
 *
 * The hash is formed from fields sorted by key and separated by a textual NUL escape. Both details
 * are load-bearing: property-map JSON order is unstable, and a safe separator prevents
 * concatenated fields from colliding.
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
    hashParts.push(binding.field + '=' + JSON.stringify(entry[1]));
  }

  return {
    properties,
    contentHash: createHash('sha256').update(hashParts.join('\0')).digest('hex').slice(0, 32),
    truncations,
  };
}
