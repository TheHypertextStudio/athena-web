/**
 * Public value resolution and payload projection rules for Docket-designed Notion databases.
 *
 * The implementation is deliberately split into contracts, reference resolution, and codec logic
 * so each concern is small enough to read without needing the provider adapter.
 */
export {
  type MirrorActorValue,
  type MirrorEntityPages,
  type MirrorReferences,
  type MirrorReferenceValue,
  type MirrorSourceValue,
  type MirrorTruncation,
  type MirrorUnresolvedReason,
  type MirrorUnresolvedRef,
  type MirrorValue,
  type ProjectedRow,
  type ResolvedMirrorValues,
} from './mirror-values/contracts';
export { resolveMirrorValues } from './mirror-values/resolution';
export {
  NOTION_RELATION_LIMIT,
  NOTION_TEXT_LIMIT,
  parseMirrorValue,
  projectRow,
  propertyValue,
  readMirrorProperties,
} from './mirror-values/codec';
