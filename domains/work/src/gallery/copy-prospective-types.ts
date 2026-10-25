import type { OrganizationId, TeamId } from '@docket/identity-access/ids';
import type { WorkTypeId, WorkTypeVersionId } from '../ids';
import type { WorkKind } from '../blueprints/types';
import type { WorkTemplateDefinition } from '../contracts/work-template';
import type { ProgramDefaultSchedule } from '../contracts/work-schedule-defaults';
import type { StepKey } from '../contracts/work-template-blueprint';
import type { CopySourceIdentity } from './copy-identity';
import type {
  CopyLabelMapping,
  CopyOmission,
  CopyDocumentEdit,
  CopyOfferingChoice,
  CopySuggestedLabelMapping,
} from './copy-types';

/** Authorized frozen source definition; unpublished sources have no physical version/projection fields. */
export interface CopyDefinitionSource {
  readonly identity: CopySourceIdentity;
  readonly kind: WorkKind;
  readonly definition: WorkTemplateDefinition;
  readonly fingerprint: string;
  readonly archived?: boolean;
  readonly defaultSchedules?: readonly ProgramDefaultSchedule[];
  readonly offeredTeamIds?: readonly TeamId[];
  readonly labelSuggestions?: readonly string[];
  readonly offeringSuggestions?: readonly string[];
}
/** Authored reference slot qualified by its exact owning source. */
export interface CopyReferenceSlot {
  readonly kind: 'blueprint_step' | 'default_schedule';
  readonly key: StepKey;
}
/** Caller-checked persisted private reservation; the pure planner itself grants no authority. */
export interface CopyDraftReservation {
  readonly organizationId: OrganizationId;
  readonly workTypeId: WorkTypeId;
  readonly reservedFirstPublicationId: WorkTypeVersionId;
  readonly draftRevision: number;
  readonly draftFingerprint: string;
}
/** One exact authored reference resolved by the service before planning. */
export interface CopyReferenceBinding {
  readonly source: CopySourceIdentity;
  readonly slot: CopyReferenceSlot;
  readonly target: CopySourceIdentity;
  readonly reservation?: CopyDraftReservation;
}
/** Destination identity metadata only; it does not assert that any publication exists. */
export interface ReservedCopyDestination {
  readonly kind: 'reserved';
  readonly source: CopySourceIdentity;
  readonly workTypeId: WorkTypeId;
  readonly reservedFirstPublicationId: WorkTypeVersionId;
}
/** New source identities qualify existing copy omission/decision shapes without carrying bodies in warnings. */
export type ProspectiveCopyOmission = Omit<CopyOmission, 'source'> & {
  readonly source: CopySourceIdentity;
};
/** Source-qualified approved asset edits. */
export type ProspectiveCopyDocumentEdit = Omit<CopyDocumentEdit, 'source'> & {
  readonly source: CopySourceIdentity;
};
/** Source-qualified destination offering decision. */
export type ProspectiveCopyOfferingChoice = Omit<CopyOfferingChoice, 'source'> & {
  readonly source: CopySourceIdentity;
};
/** Source-qualified explicit catalog label decision. */
export type ProspectiveCopySuggestedLabelMapping = Omit<CopySuggestedLabelMapping, 'source'> & {
  readonly source: CopySourceIdentity;
};
/** Frozen authorized source facts and reviewed decisions; preview requires no destination IDs. */
export interface TemplateCopySourcesInput {
  readonly destinationOrganizationId: OrganizationId;
  readonly roots: readonly CopySourceIdentity[];
  readonly sources: readonly CopyDefinitionSource[];
  readonly bindings: readonly CopyReferenceBinding[];
  readonly labelMappings?: readonly CopyLabelMapping[];
  readonly suggestedLabelMappings?: readonly ProspectiveCopySuggestedLabelMapping[];
  readonly offeringChoices?: readonly ProspectiveCopyOfferingChoice[];
  readonly documentEdits?: readonly ProspectiveCopyDocumentEdit[];
}
/** Exact service-reserved identities allocated only for accepted installation planning. */
export interface ReservedTemplateCopyInput extends TemplateCopySourcesInput {
  readonly destinations: readonly ReservedCopyDestination[];
}
/** A validation-only, dependency-first copy unit, before destination identities are allocated. */
export interface ProspectiveCopyUnit {
  readonly source: CopySourceIdentity;
  readonly sourceFingerprint: string;
  readonly kind: WorkKind;
  /** Reviewed destination fields with honest source-namespace references, never executable pins. */
  readonly previewDefinition: WorkTemplateDefinition;
  readonly offeredTeamIds: readonly TeamId[];
  readonly dependencies: readonly CopySourceIdentity[];
  /** Exact checked references, so multiple versions of one template remain distinguishable. */
  readonly referenceBindings: readonly Pick<CopyReferenceBinding, 'slot' | 'target'>[];
}
/** Safe semantic preview; it contains no invented publication or physical projection identities. */
export interface TemplateCopySourcesPreview {
  readonly reviewFingerprint: string;
  readonly copies: readonly ProspectiveCopyUnit[];
  readonly roots: readonly CopySourceIdentity[];
  readonly omissions: readonly ProspectiveCopyOmission[];
}
/** Canonical draft definition pinned to honest persisted first-publication reservations. */
export interface ReservedPlannedTemplateCopy extends ReservedCopyDestination {
  readonly organizationId: OrganizationId;
  readonly sourceFingerprint: string;
  readonly definition: WorkTemplateDefinition;
  readonly offeredTeamIds: readonly TeamId[];
}
/** Accepted pure plan; canonical writing/publication and authorization remain service work. */
export interface ReservedTemplateCopyPlan {
  readonly reviewFingerprint: string;
  readonly copies: readonly ReservedPlannedTemplateCopy[];
  readonly roots: readonly ReservedCopyDestination[];
  readonly omissions: readonly ProspectiveCopyOmission[];
}
