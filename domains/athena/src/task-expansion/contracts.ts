import type { Priority } from '@docket/work/task-contract';

/** A task that expansion may name in a dependency or related-task link. */
export interface ExpansionTaskReference {
  /** Stable task identifier. */
  readonly id: string;
  /** Current task title supplied only as model context. */
  readonly title: string;
}

/** A resolved task resource the synthesizer may cite in the expanded description. */
export interface ExpansionResourceReference {
  /** Canonical URL already visible from the task's own resources or inline references. */
  readonly url: string | null;
  /** Human label supplied as context, never invented by a model. */
  readonly title: string;
}

/** Values a person already set on the task and expansion must not replace. */
export interface ExplicitTaskValues {
  /** Existing priority, when someone set it. */
  readonly priority?: Priority | undefined;
  /** Existing assignee, when someone set one. */
  readonly assigneeId?: string | null | undefined;
  /** Existing project, when someone set one. */
  readonly projectId?: string | null | undefined;
  /** Existing due day, when someone set one. */
  readonly dueDate?: string | null | undefined;
  /** Existing anticipated start day, when someone set one. */
  readonly startDate?: string | null | undefined;
  /** Existing effort estimate, when someone set one. */
  readonly estimateMinutes?: number | null | undefined;
  /** Existing labels, when someone set them. */
  readonly labelIds?: readonly string[] | undefined;
}

/** Values retained by the selected task template after its mutable draft has been saved. */
export interface TaskExpansionTemplateDefaults {
  /** Template priority to apply only while the task priority remains unset. */
  readonly priority?: Priority | undefined;
  /** Template labels to apply only while the task has no labels. */
  readonly labelIds?: readonly string[] | undefined;
}

/** The closed context handed to an expansion synthesizer. */
export interface TaskExpansionInput {
  /** Stable identifier of the task being expanded. */
  readonly taskId: string;
  /** Task title. */
  readonly title: string;
  /** Authored Markdown before expansion. */
  readonly description: string | null;
  /** The selected task template's Markdown structure, when one is retained. */
  readonly templateDescription?: string | undefined;
  /** Persisted structured defaults from the selected task template. */
  readonly templateDefaults?: TaskExpansionTemplateDefaults | undefined;
  /** Person-authored values that win over an inference. */
  readonly explicit: ExplicitTaskValues;
  /** Tasks expansion may name by id. No unlisted id is valid. */
  readonly availableTasks: readonly ExpansionTaskReference[];
  /** Resolved task resources expansion may cite. No other source URL is valid. */
  readonly resources?: readonly ExpansionResourceReference[] | undefined;
}

/** A new child task that the source clearly implies. */
export interface ExpansionSubtask {
  /** Child title. */
  readonly title: string;
  /** Optional Markdown body. */
  readonly description?: string | undefined;
  /** Exact non-empty excerpt from the task description that names this contained outcome. */
  readonly evidence: string;
}

/** One directed dependency that names two existing tasks. */
export interface ExpansionDependency {
  /** Existing task that must finish first. */
  readonly blockingTaskId: string;
  /** Existing task waiting on the blocker. */
  readonly blockedTaskId: string;
  /** Exact non-empty excerpt that names both endpoints and explicitly states the wait or block. */
  readonly evidence: string;
}

/** Fields expansion may supply only when they were not explicit. */
export interface ExpansionPropertyPatch {
  /** Inferred priority. */
  readonly priority?: Priority | undefined;
  /** Inferred task owner. */
  readonly assigneeId?: string | undefined;
  /** Inferred project. */
  readonly projectId?: string | undefined;
  /** Inferred due day. */
  readonly dueDate?: string | undefined;
  /** Inferred anticipated start day. */
  readonly startDate?: string | undefined;
  /** Inferred effort estimate. */
  readonly estimateMinutes?: number | undefined;
  /** Inferred replacement labels. */
  readonly labelIds?: readonly string[] | undefined;
}

/** The structured candidate a synthesizer returns before the domain constrains it. */
export interface TaskExpansionCandidate {
  /** Replacement Markdown for the existing task description. */
  readonly description: string;
  /** Optional missing property values. */
  readonly patch?: ExpansionPropertyPatch | undefined;
  /** Clearly implied contained work. */
  readonly subtasks?: readonly ExpansionSubtask[] | undefined;
  /** Explicit directed sequencing links. */
  readonly dependencies?: readonly ExpansionDependency[] | undefined;
  /** Existing tasks with association but no scheduling meaning. */
  readonly relatedTaskIds?: readonly string[] | undefined;
  /** External links the synthesized Markdown intentionally uses. */
  readonly resourceUrls?: readonly string[] | undefined;
}

/** A fully constrained result that the API may apply. */
export interface TaskExpansionResult {
  /** Replacement Markdown that still contains authored text and template structure. */
  readonly description: string;
  /** Only absent properties that passed the closed-world checks. */
  readonly patch: ExpansionPropertyPatch;
  /** Valid child-task candidates. */
  readonly subtasks: readonly ExpansionSubtask[];
  /** Valid dependency candidates. */
  readonly dependencies: readonly ExpansionDependency[];
  /** Valid related-task ids. */
  readonly relatedTaskIds: readonly string[];
  /** Safe URLs also present in the Markdown description. */
  readonly resourceUrls: readonly string[];
}

/** The runtime boundary that expands one existing task description. */
export interface TaskExpansionSynthesizer {
  /** Produce a structured candidate for one task. */
  expandTask(input: TaskExpansionInput): Promise<TaskExpansionResult>;
}
