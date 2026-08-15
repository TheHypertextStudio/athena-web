/**
 * Projection-order and designer helpers for the Notion mirror catalog.
 *
 * This module contains derived rules; the authored entity field definitions live in
 * `./catalog`.
 */
import type {
  NotionColumnBinding,
  NotionMirrorEntity,
  NotionPropertyKind,
  NotionPropertyMap,
} from '../mirror-contract';
import { resolveVocabularyTerm, type VocabularySkin } from '@docket/work/vocabulary';

import {
  MIRROR_ENTITY_ORDER,
  MIRROR_ENTITY_SPECS,
  type MirrorEntitySpec,
  type MirrorField,
} from './catalog';

/**
 * The order rows are projected in.
 *
 * Person pages come first so ordinary people relations can resolve on the first pass. Three
 * catalog cycles still require a second pass: `person.teams`, `program.projects`, and
 * `project.initiatives`. None is a default column.
 */
export const MIRROR_PROJECTION_ORDER: readonly NotionMirrorEntity[] = [
  'person',
  'team',
  'label',
  'program',
  'project',
  'initiative',
  'milestone',
  'cycle',
  'task',
];

/** One relation declared by the catalog. */
export interface MirrorRelationEdge {
  /** Entity declaring the relation. */
  readonly from: NotionMirrorEntity;
  /** Field key declaring the relation. */
  readonly field: string;
  /** Entity the relation needs to point at. */
  readonly to: NotionMirrorEntity;
}

/** Return every relation edge in catalog order. */
export function relationEdges(): MirrorRelationEdge[] {
  const edges: MirrorRelationEdge[] = [];
  for (const entity of MIRROR_ENTITY_ORDER) {
    for (const field of MIRROR_ENTITY_SPECS[entity].fields) {
      if (field.personCompanionOf !== undefined) continue;
      const to = field.personValued === true ? 'person' : field.relationEntity;
      if (to !== undefined) edges.push({ from: entity, field: field.field, to });
    }
  }
  return edges;
}

/**
 * Return the relation edges that cannot resolve in one projection pass.
 *
 * A missing entity in the declared order counts as deferred so catalog validation cannot hide a
 * bad projection order.
 */
export function deferredRelationEdges(): MirrorRelationEdge[] {
  const position = new Map(MIRROR_PROJECTION_ORDER.map((entity, index) => [entity, index]));
  return relationEdges().filter((edge) => {
    const from = position.get(edge.from);
    const to = position.get(edge.to);
    if (from === undefined || to === undefined) return true;
    return to > from;
  });
}

/** Resolve the default database title through an organization's vocabulary skin. */
export function defaultDatabaseTitle(
  entity: NotionMirrorEntity,
  skin: VocabularySkin | null | undefined,
): string {
  const spec = MIRROR_ENTITY_SPECS[entity];
  if (spec.vocabularyKey === undefined) return spec.defaultTitle;
  return resolveVocabularyTerm(skin, spec.vocabularyKey).plural;
}

/**
 * Resolve a default column title through the related entity's vocabulary term when appropriate.
 */
export function defaultColumnTitle(
  entity: NotionMirrorEntity,
  field: string,
  skin: VocabularySkin | null | undefined,
): string | undefined {
  const spec = MIRROR_ENTITY_SPECS[entity].fields.find((entry) => entry.field === field);
  if (spec === undefined) return undefined;
  const target = spec.relationEntity;
  if (target !== undefined) {
    const targetKey = MIRROR_ENTITY_SPECS[target].vocabularyKey;
    if (targetKey !== undefined) {
      const term = resolveVocabularyTerm(skin, targetKey);
      return spec.label.endsWith('s') ? term.plural : term.singular;
    }
  }
  return spec.label;
}

/** Create an unprovisioned default property map for an entity. */
export function defaultPropertyMap(
  entity: NotionMirrorEntity,
  skin: VocabularySkin | null | undefined,
): NotionPropertyMap {
  const spec = MIRROR_ENTITY_SPECS[entity];
  const map: Record<string, NotionColumnBinding> = {};
  let order = 0;
  for (const field of spec.defaultColumns) {
    const definition = spec.fields.find((entry) => entry.field === field);
    if (definition === undefined) continue;
    map[field] = {
      field,
      title: defaultColumnTitle(entity, field, skin) ?? definition.label,
      kind: definition.kind,
      order: order++,
      ...(definition.personValued === true ? { representation: 'text' as const } : {}),
    };
  }
  return map;
}

/** Look up one field in the catalog. */
export function mirrorField(entity: NotionMirrorEntity, field: string): MirrorField | undefined {
  return MIRROR_ENTITY_SPECS[entity].fields.find((entry) => entry.field === field);
}

/** Return the fields whose Notion edits can apply to a two-way entity. */
export function writableFields(entity: NotionMirrorEntity): readonly string[] {
  const spec: MirrorEntitySpec = MIRROR_ENTITY_SPECS[entity];
  if (spec.direction !== 'two_way') return [];
  return spec.fields.filter((field) => field.writable === true).map((field) => field.field);
}

/** Return designed columns in their explicit left-to-right order. */
export function orderedColumns(map: NotionPropertyMap): NotionColumnBinding[] {
  return Object.values(map).sort((a, b) => a.order - b.order);
}

/** Invert a property map into a Notion-property-id-to-Docket-field lookup. */
export function fieldsByPropertyId(map: NotionPropertyMap): Map<string, string> {
  const byId = new Map<string, string>();
  for (const binding of Object.values(map)) {
    if (binding.propertyId !== undefined) byId.set(binding.propertyId, binding.field);
  }
  return byId;
}

/**
 * Resolve a column to the Notion property kind that will actually be provisioned.
 *
 * A native Notion person is a separate generated `people` companion column. The original
 * person-valued column remains rich text, preserving people that lack Notion accounts.
 */
export function provisionedKind(binding: NotionColumnBinding): NotionPropertyKind {
  switch (binding.representation) {
    case 'notion_person':
    case 'text':
      return 'rich_text';
    case 'docket_people_table':
    case 'existing_table':
      return 'relation';
    default:
      return binding.kind;
  }
}
