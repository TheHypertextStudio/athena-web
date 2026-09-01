import { z } from 'zod';

const ulid = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const ownedId = z.string().regex(ulid);
const genericOwnedId = ownedId
  .describe('A 26-char Crockford base-32 ULID matching `^[0-9A-HJKMNP-TV-Z]{26}$`.')
  .meta({ example: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });

/** Initiative identifier. */
export const InitiativeId = ownedId
  .brand<'InitiativeId'>()
  .describe(
    'ULID id of an Initiative — the highest planning altitude, grouping Programs/Projects toward a strategic outcome.',
  );
/** Initiative identifier value. */
export type InitiativeId = z.infer<typeof InitiativeId>;
/** Program identifier. */
export const ProgramId = ownedId
  .brand<'ProgramId'>()
  .describe('ULID id of a Program — a mid-altitude grouping of related Projects.');
/** Program identifier value. */
export type ProgramId = z.infer<typeof ProgramId>;
/** Project identifier. */
export const ProjectId = ownedId
  .brand<'ProjectId'>()
  .describe(
    'ULID id of a Project — a bounded body of work containing Tasks, with status and health.',
  );
/** Project identifier value. */
export type ProjectId = z.infer<typeof ProjectId>;
/** Milestone identifier. */
export const MilestoneId = ownedId
  .brand<'MilestoneId'>()
  .describe('ULID id of a Milestone — a dated checkpoint within a Project.');
/** Milestone identifier value. */
export type MilestoneId = z.infer<typeof MilestoneId>;
/** Cycle identifier. */
export const CycleId = ownedId
  .brand<'CycleId'>()
  .describe('ULID id of a Cycle — a time-boxed iteration (sprint) Tasks can be scheduled into.');
/** Cycle identifier value. */
export type CycleId = z.infer<typeof CycleId>;
/** Task identifier. */
export const TaskId = ownedId
  .brand<'TaskId'>()
  .describe(
    'ULID id of a Task — the atomic unit of work, with status, priority, assignee, and dependencies.',
  );
/** Task identifier value. */
export type TaskId = z.infer<typeof TaskId>;
/** Work status identifier. */
export const WorkStatusId = ownedId
  .brand<'WorkStatusId'>()
  .describe(
    'ULID id of a work status — one entry in a workspace’s status set for Tasks, Projects, Programs, or Initiatives.',
  );
/** Work status identifier value. */
export type WorkStatusId = z.infer<typeof WorkStatusId>;
/** Label identifier. */
export const LabelId = ownedId
  .brand<'LabelId'>()
  .describe('ULID id of a Label — a reusable tag applied to Tasks/Projects for filtering.');
/** Label identifier value. */
export type LabelId = z.infer<typeof LabelId>;
/** Label group identifier. */
export const LabelGroupId = ownedId
  .brand<'LabelGroupId'>()
  .describe(
    'ULID id of a Label group — a named set of related Labels, optionally mutually exclusive.',
  );
/** Label group identifier value. */
export type LabelGroupId = z.infer<typeof LabelGroupId>;
/** Comment identifier. */
export const CommentId = ownedId
  .brand<'CommentId'>()
  .describe('ULID id of a Comment — a threaded message on a Task or other commentable entity.');
/** Comment identifier value. */
export type CommentId = z.infer<typeof CommentId>;
/** Attachment identifier. */
export const AttachmentId = ownedId
  .brand<'AttachmentId'>()
  .describe('ULID id of an Attachment — an uploaded file linked to an entity.');
/** Attachment identifier value. */
export type AttachmentId = z.infer<typeof AttachmentId>;
/** Document image identifier. */
export const DocumentImageId = ownedId
  .brand<'DocumentImageId'>()
  .describe(
    'ULID id of a DocumentImage — an image stored for use inline inside an entity’s prose.',
  );
/** Document image identifier value. */
export type DocumentImageId = z.infer<typeof DocumentImageId>;
/** Status update identifier. */
export const UpdateId = ownedId
  .brand<'UpdateId'>()
  .describe(
    'ULID id of an Update — a posted status/progress narrative on a Project, Program, or Initiative.',
  );
/** Status update identifier value. */
export type UpdateId = z.infer<typeof UpdateId>;
/** Saved view identifier. */
export const SavedViewId = ownedId
  .brand<'SavedViewId'>()
  .describe(
    'ULID id of a SavedView — a stored filter/sort/grouping configuration over a work list.',
  );
/** Saved view identifier value. */
export type SavedViewId = z.infer<typeof SavedViewId>;
/** Work template identifier. */
export const TemplateId = ownedId
  .brand<'TemplateId'>()
  .describe(
    'ULID id of a Template — a reusable pre-filled draft for creating a Task, Project, Initiative, or Program.',
  );
/** Work template identifier value. */
export type TemplateId = z.infer<typeof TemplateId>;
/** Process definition identifier. */
export const ProcessDefinitionId = ownedId
  .brand<'ProcessDefinitionId'>()
  .describe(
    'ULID id of a ProcessDefinition — a reusable, versioned description of work Docket can materialize.',
  );
/** Process definition identifier value. */
export type ProcessDefinitionId = z.infer<typeof ProcessDefinitionId>;
/** Process revision identifier. */
export const ProcessRevisionId = ownedId
  .brand<'ProcessRevisionId'>()
  .describe('ULID id of a ProcessRevision — one immutable version of a process definition.');
/** Process revision identifier value. */
export type ProcessRevisionId = z.infer<typeof ProcessRevisionId>;
/** Process step identifier. */
export const ProcessStepId = ownedId
  .brand<'ProcessStepId'>()
  .describe(
    'ULID id of a ProcessStep — one project, milestone, or task specification within a process revision.',
  );
/** Process step identifier value. */
export type ProcessStepId = z.infer<typeof ProcessStepId>;
/** Recurrence series identifier. */
export const RecurrenceSeriesId = ownedId
  .brand<'RecurrenceSeriesId'>()
  .describe('ULID id of a RecurrenceSeries — a schedule that expects process occurrences.');
/** Recurrence series identifier value. */
export type RecurrenceSeriesId = z.infer<typeof RecurrenceSeriesId>;
/** Recurrence series revision identifier. */
export const RecurrenceSeriesRevisionId = ownedId
  .brand<'RecurrenceSeriesRevisionId'>()
  .describe(
    'ULID id of a RecurrenceSeriesRevision — one immutable trigger version within a recurrence series.',
  );
/** Recurrence series revision identifier value. */
export type RecurrenceSeriesRevisionId = z.infer<typeof RecurrenceSeriesRevisionId>;
/** Recurrence occurrence identifier. */
export const OccurrenceId = ownedId
  .brand<'OccurrenceId'>()
  .describe('ULID id of an Occurrence — one durable expected run of a recurrence series.');
/** Recurrence occurrence identifier value. */
export type OccurrenceId = z.infer<typeof OccurrenceId>;
/** Materialized process instance identifier. */
export const ProcessInstanceId = ownedId
  .brand<'ProcessInstanceId'>()
  .describe(
    'ULID id of a ProcessInstance — concrete Docket work materialized from one process revision.',
  );
/** Materialized process instance identifier value. */
export type ProcessInstanceId = z.infer<typeof ProcessInstanceId>;
/** Entity mention identifier. */
export const MentionId = ownedId
  .brand<'MentionId'>()
  .describe("ULID id of a Mention — one reference authored inside an entity's prose.");
/** Entity mention identifier value. */
export type MentionId = z.infer<typeof MentionId>;

/** Initiative hierarchy link identifier. */
export const InitiativeHierarchyLinkId = genericOwnedId.brand<'InitiativeHierarchyLinkId'>();
/** Initiative hierarchy link identifier value. */
export type InitiativeHierarchyLinkId = z.infer<typeof InitiativeHierarchyLinkId>;

/** Work entity identifier used by relationships that accept several work kinds. */
export const WorkEntityId = genericOwnedId.brand<'WorkEntityId'>();
/** Work entity identifier value. */
export type WorkEntityId = z.infer<typeof WorkEntityId>;

/** Public work publication identifier. */
export const WorkPublicationId = genericOwnedId.brand<'WorkPublicationId'>();
/** Public work publication identifier value. */
export type WorkPublicationId = z.infer<typeof WorkPublicationId>;

/** Public work domain identifier. */
export const WorkPublicDomainId = genericOwnedId.brand<'WorkPublicDomainId'>();
/** Public work domain identifier value. */
export type WorkPublicDomainId = z.infer<typeof WorkPublicDomainId>;
