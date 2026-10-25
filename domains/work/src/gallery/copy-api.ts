/** Pure copy boundary; authorized services own source reads, identity reservations and canonical writes. */
export {
  CatalogVersionId,
  CopySourceIdentity,
  copyIdentityKey,
  copyIdentityScope,
  copyDefinitionKey,
} from './copy-identity';
export { catalogCopySource, catalogCopyBindings } from './copy-catalog-adapter';
export { previewTemplateCopySources, planTemplateCopySources } from './copy-prospective-plan';
export { fingerprintCopyFacts } from './copy-fingerprint';
export { copyFacts } from './copy-facts';
export { normalizeCopyDefinition } from './copy-normalize';
export type {
  CopyDefinitionSource,
  CopyReferenceSlot,
  CopyDraftReservation,
  CopyReferenceBinding,
  ReservedCopyDestination,
  ProspectiveCopyOmission,
  ProspectiveCopyDocumentEdit,
  ProspectiveCopyOfferingChoice,
  ProspectiveCopySuggestedLabelMapping,
  TemplateCopySourcesInput,
  ReservedTemplateCopyInput,
  ProspectiveCopyUnit,
  TemplateCopySourcesPreview,
  ReservedPlannedTemplateCopy,
  ReservedTemplateCopyPlan,
} from './copy-prospective-types';
export type { CopyLabelMapping } from './copy-types';
export { authoredCopyReferences } from './copy-prospective-source';
export {
  WorkTemplateCopySourceSelection,
  WorkTemplateSourceCopyPreviewRequest,
  WorkTemplateSourceCopyPreview,
  WorkTemplateSourceCopyAcceptRequest,
} from '../contracts/template-source-copy';
