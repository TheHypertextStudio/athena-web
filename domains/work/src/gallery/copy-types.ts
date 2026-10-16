import type { OrganizationId, TeamId } from '@docket/identity-access/ids';
import type { LabelId, WorkTypeId, WorkTypeVersionId } from '../ids';
import type { PublishedBlueprintSnapshot } from '../blueprints/types';
import type { WorkTemplateDefinition } from '../contracts/work-template';
import type { ProgramDefaultSchedule } from '../contracts/work-schedule-defaults';

/** One exact source publication; source visibility is checked by the caller before supplying it. */
export interface CopySourceRef {
  readonly workTypeId: WorkTypeId;
  readonly versionId: WorkTypeVersionId;
}
/** Checked source facts; catalog sibling schedules are normalized into the canonical definition. */
export interface CopySourceSnapshot {
  readonly snapshot: PublishedBlueprintSnapshot;
  readonly fingerprint: string;
  /** Actual source archive state; exact authorized pins remain copyable while latest cannot select it. */
  readonly archived?: boolean;
  readonly defaultSchedules?: readonly ProgramDefaultSchedule[];
  readonly offeredTeamIds?: readonly TeamId[];
  readonly labelSuggestions?: readonly string[];
  readonly offeringSuggestions?: readonly string[];
}
/** Caller-minted independent destination pair, allocated by the future installation transaction. */
export interface CopyDestination extends CopySourceRef {
  readonly source: CopySourceRef;
}
/** Explicit checked label translation; labels without a matching entry are omitted. */
export interface CopyLabelMapping {
  readonly sourceOrganizationId: OrganizationId;
  readonly sourceLabelId: LabelId;
  readonly destinationLabelId: LabelId;
}
/** Explicit destination resolution of a catalog label suggestion, never inferred by name. */
export interface CopySuggestedLabelMapping {
  readonly source: CopySourceRef;
  readonly suggestion: string;
  readonly destinationLabelId: LabelId;
}
/** Exact approved document replacement; the caller must resolve asset policy before acceptance. */
export interface CopyDocumentEdit {
  readonly source: CopySourceRef;
  readonly path: readonly (string | number)[];
  readonly original: string;
  readonly replacement: string;
  readonly omittedImageCount: number;
}
/** Destination offerings explicitly selected and authorized by the caller, never inherited. */
export interface CopyOfferingChoice {
  readonly source: CopySourceRef;
  readonly teamIds: readonly TeamId[];
}
/** Exact authorized closure plus frozen latest selections; the planner performs no reads or grants. */
export interface TemplateCopyInput {
  readonly destinationOrganizationId: OrganizationId;
  readonly roots: readonly CopySourceRef[];
  readonly sources: readonly CopySourceSnapshot[];
  readonly bases: readonly PublishedBlueprintSnapshot[];
  readonly latest: readonly CopySourceRef[];
  readonly destinations: readonly CopyDestination[];
  readonly labelMappings?: readonly CopyLabelMapping[];
  readonly suggestedLabelMappings?: readonly CopySuggestedLabelMapping[];
  readonly offeringChoices?: readonly CopyOfferingChoice[];
  readonly documentEdits?: readonly CopyDocumentEdit[];
}
/** A specific dropped source-local reference or unresolved destination suggestion. */
export interface CopyOmission {
  readonly source: CopySourceRef;
  readonly kind: 'label' | 'image' | 'offering' | 'label_suggestion' | 'offering_suggestion';
  readonly path: readonly (string | number)[];
  readonly count: number;
  readonly value?: string;
}
/** Canonical independent definition, ready for the existing destination writer after live rechecks. */
export interface PlannedTemplateCopy extends CopyDestination {
  readonly organizationId: OrganizationId;
  readonly sourceFingerprint: string;
  readonly definition: WorkTemplateDefinition;
  readonly offeredTeamIds: readonly TeamId[];
}
/** Deterministic dependency-first bundle; installation/publication and aggregate undo remain API work. */
export interface TemplateCopyPlan {
  readonly copies: readonly PlannedTemplateCopy[];
  readonly roots: readonly CopySourceRef[];
  readonly omissions: readonly CopyOmission[];
}
