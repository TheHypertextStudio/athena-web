/**
 * Public rules for Docket-designed Notion database schemas.
 *
 * The public module is intentionally a narrow, explicit subpath. Its implementation is split by
 * authored catalog versus derived projection rules so each file remains approachable in isolation.
 */
export {
  MIRROR_ENTITY_ORDER,
  MIRROR_ENTITY_SPECS,
  personCompanionKey,
  type MirrorEntitySpec,
  type MirrorField,
} from './mirror-schema/catalog';
export {
  MIRROR_PROJECTION_ORDER,
  defaultColumnTitle,
  defaultDatabaseTitle,
  defaultPropertyMap,
  deferredRelationEdges,
  fieldsByPropertyId,
  mirrorField,
  orderedColumns,
  provisionedKind,
  relationEdges,
  writableFields,
  type MirrorRelationEdge,
} from './mirror-schema/projection';
