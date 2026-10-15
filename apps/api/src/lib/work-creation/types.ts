import type { RetainedRootBinding } from './retained-authority';
import type { TaskCreate } from '@docket/work/task-model';
import type { InitiativeCreate } from '@docket/work/initiative-contract';
import type { ProgramCreate } from '@docket/work/program-contract';
import type { RecordedOrigin } from '@docket/work/provenance-contract';
import type { TeamId } from '@docket/identity-access/ids';
import type { ResolvedVersionAtPath as BlueprintResolvedVersionAtPath } from '@docket/work/work-template-blueprint';
import type { OptionalChoice } from '@docket/work/work-template-blueprint';
import type { ProjectCreate } from '../../contracts/project';
import type { ActorCtx } from '../../context';
import type { RecordedChange } from '../../mcp/change-set';
import type { ResolvedLabel } from '../labels';
import type { PreparedMilestoneRow } from '../milestone-writes';
import type { TaskStateMutation } from '../task-state';
import type { InsertedWork, ResolvedWorkInsert } from './writers';

/** Ordinary creation keeps the four existing public request vocabularies. */
export interface WorkCreateBodyByKind {
  readonly task: TaskCreate;
  readonly project: ProjectCreate;
  readonly initiative: InitiativeCreate;
  readonly program: ProgramCreate;
}

/** The existing kinds that can own a work template. */
export type WorkKind = keyof WorkCreateBodyByKind;

/** Server-only attribution and replay scope, constructed by an existing entry adapter. */
export interface TrustedCreationInvocation {
  readonly origin: RecordedOrigin;
  readonly replayKey?: string;
  readonly prospectiveWorkId?: string;
  /** Resolved adapter-only placement fields absent from an ordinary public DTO. */
  readonly placement?: {
    readonly programId?: string | null;
    readonly visibility?: 'public' | 'private';
    readonly initiativeId?: string | null;
  };
  readonly labelIds?: readonly string[];
  readonly retainedBinding?: RetainedRootBinding;
}

/** An authenticated ordinary create command, correlated with its existing request body. */
export type WorkCreationCommand<K extends WorkKind = WorkKind> = {
  [P in K]: {
    readonly caller: ActorCtx;
    readonly kind: P;
    readonly body: WorkCreateBodyByKind[P];
    readonly blueprint?: {
      readonly previewToken?: string | undefined;
      readonly creationTeamId?: TeamId | undefined;
      readonly optionalChoices: readonly OptionalChoice[];
    };
    readonly invocation: TrustedCreationInvocation;
  };
}[K];

/** Existing adapters retain their actual authority; a missing creator is never a fake human. */
export interface TrustedCreationAuthority {
  readonly kind: 'retained-recurrence';
  readonly orgId: string;
  readonly actorId: null;
  readonly binding: { readonly seriesId: string; readonly revisionId: string };
  /** Opaque identity checked against the transaction that authorized the retained binding. */
  readonly proof: object;
}

/** Internal command for already-authorized adapters, with live checks whenever an actor exists. */
export type TrustedWorkCreationCommand = {
  [K in WorkKind]: Omit<WorkCreationCommand<K>, 'caller'> & {
    readonly caller: TrustedCreationAuthority;
  };
}[WorkKind];

/** Commands accepted by the shared mutation core, including trusted existing adapters. */
export type OrdinaryWorkCommand = WorkCreationCommand | TrustedWorkCreationCommand;

/** A resolved immutable publication selected at one qualified blueprint path. */
export interface ResolvedVersionAtPath {
  readonly path: readonly string[];
  readonly workTypeId: string;
  readonly versionId: string;
}

/** Existing post-commit work represented as data, never a client-provided callback. */
export type DeferredWorkEffect =
  | {
      readonly kind: 'refresh-subject';
      readonly dedupeKey: string;
      readonly orgId: string;
      readonly subjectKind: string;
      readonly subjectId: string;
    }
  | {
      readonly kind: 'tool-activity';
      readonly dedupeKey: string;
      readonly orgId: string;
      readonly actorId: string;
      readonly changes: readonly RecordedChange[];
    }
  | {
      readonly kind: 'created';
      readonly dedupeKey: string;
      readonly work: InsertedWork;
      readonly actorId: string | null;
    }
  | { readonly kind: 'search'; readonly dedupeKey: string; readonly work: InsertedWork }
  | {
      readonly kind: 'task-state';
      readonly dedupeKey: string;
      readonly mutation: TaskStateMutation;
    };

/** Prepared ordinary values and associations; preparation never inserts a row. */
export interface PreparedOrdinaryWork {
  readonly command: OrdinaryWorkCommand;
  readonly insert: ResolvedWorkInsert;
  readonly labels: readonly ResolvedLabel[];
  readonly initiativeIds: readonly string[];
  readonly relatedTaskIds: readonly string[];
  readonly milestones: readonly NonNullable<ProjectCreate['milestones']>[number][];
  readonly milestoneRows?: readonly PreparedMilestoneRow[];
}

/** Server-only prospective references, bound to one checked planner authority and transaction. */
export interface OrdinaryPreparationContext {
  readonly orgId: string;
  readonly actorId: string | null;
  readonly rootVisibility: 'public' | 'private';
  readonly publishedChildren: ReadonlyMap<string, AuthorizedPublishedChild>;
  readonly prospective: ReadonlyMap<string, ProspectiveWorkReference>;
  readonly proof: object;
}

/** Unrecorded mutation for an enclosing plan or blueprint's single aggregate receipt. */
export interface OrdinaryWorkMutation {
  readonly root: InsertedWork;
  readonly created: readonly InsertedWork[];
  readonly changes: readonly RecordedChange[];
  readonly effects: readonly DeferredWorkEffect[];
  readonly parentTaskIds: readonly (string | null)[];
}

/** One committed or transaction-owned root and all work it created. */
export interface WorkCreationResult extends OrdinaryWorkMutation {
  readonly changeSetId: string | null;
  readonly resolvedManifest: readonly ResolvedVersionAtPath[];
}

/** Trusted plan/legacy forest roots, sharing one receipt and tenant authority. */
export interface WorkCreationBatchCommand {
  readonly roots: readonly { readonly key: string; readonly command: OrdinaryWorkCommand }[];
  readonly edges: readonly ResolvedInvocationEdge[];
  readonly invocation: TrustedCreationInvocation;
}

/** A validated ordinary dependency joining roots in an existing trusted forest. */
export interface ResolvedInvocationEdge {
  readonly blocker: { readonly rootKey: string; readonly path: readonly string[] };
  readonly blocked: { readonly rootKey: string; readonly path: readonly string[] };
}

/** Aggregate result for one existing plan or recurrence transaction. */
export interface WorkCreationBatchResult {
  readonly rootsByKey: ReadonlyMap<string, InsertedWork>;
  /** Server-only accepted closures, including adopted roots whose public state remains untouched. */
  readonly resolvedManifestsByKey: ReadonlyMap<string, readonly BlueprintResolvedVersionAtPath[]>;
  /** Exact accepted row identities, including adopted work and selected checkpoints. */
  readonly selectedWorkByKey: ReadonlyMap<string, readonly WorkCreationSelectedRow[]>;
  readonly created: readonly InsertedWork[];
  readonly changeSetId: string | null;
  readonly effects: readonly DeferredWorkEffect[];
}

/** Server-only accepted path and actual row identity; never inferred from later public origins. */
export interface WorkCreationSelectedRow {
  readonly path: readonly string[];
  readonly kind: InsertedWork['kind'];
  readonly id: string;
}

/** Minimal prospective placement snapshot; status/default resolution does not need to have run. */
export type ProspectiveWorkReference = { readonly id: string; readonly orgId: string } & (
  | { readonly kind: 'initiative' }
  | { readonly kind: 'program'; readonly visibility: 'public' | 'private' }
  | {
      readonly kind: 'project';
      readonly visibility: 'public' | 'private';
      readonly programId?: string | null;
    }
  | { readonly kind: 'milestone'; readonly projectId: string }
  | {
      readonly kind: 'task';
      readonly visibility: 'public' | 'private';
      readonly projectId?: string | null;
      readonly programId?: string | null;
      readonly parentTaskId?: string | null;
    }
);

/** Exact published child selection already authorized by the canonical closure resolver. */
export interface AuthorizedPublishedChild {
  readonly prospectiveWorkId: string;
  readonly kind: WorkKind;
  readonly workTypeId: string;
  readonly workTypeVersionId: string;
}
