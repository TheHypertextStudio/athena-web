/**
 * `tasks/task-create-body` — the `POST /tasks` body for a task composer draft.
 *
 * @remarks
 * Only the fields the draft sets are sent. A `~` token in the title (`Draft the brief ~45m`,
 * Sunsama's planned-time syntax) sets the time estimate and leaves the title; a time chosen in the
 * picker wins over the token. A title that is nothing but a token keeps its text.
 */
import { ActorId, TeamId } from '@docket/identity-access/ids';
import { CycleId, LabelId, MilestoneId, ProjectId } from '@docket/work/ids';
import type { TaskCreate } from '@docket/work/task-model';

import { parseTitleEstimate } from '@/lib/parse-estimate';

import type { TaskDraft } from './create-task';

/** The draft's title and time estimate, with any `~` token applied. */
export interface DraftTitleEstimate {
  /** The title to save. */
  readonly title: string;
  /** The time estimate in minutes, or `null` for none. */
  readonly estimateMinutes: number | null;
}

/**
 * Resolve the title and time estimate a draft will save.
 *
 * @param draft - The composer draft's title and chosen time estimate.
 * @returns the trimmed title without a valid `~` token, and the chosen or typed estimate.
 */
export function draftTitleEstimate(
  draft: Pick<TaskDraft, 'title' | 'estimateMinutes'>,
): DraftTitleEstimate {
  const title = draft.title.trim();
  const token = parseTitleEstimate(title);
  if (token === null || token.title === '') {
    return { title, estimateMinutes: draft.estimateMinutes };
  }
  return { title: token.title, estimateMinutes: draft.estimateMinutes ?? token.minutes };
}

/**
 * Build the create body for a draft.
 *
 * @param draft - The composer draft.
 * @param teamId - The team the task is created in.
 * @returns the request body.
 */
export function taskCreateBody(draft: TaskDraft, teamId: string): TaskCreate {
  const { title, estimateMinutes } = draftTitleEstimate(draft);
  const description = draft.description.trim();
  return {
    title,
    teamId: TeamId.parse(teamId),
    priority: draft.priority,
    ...(description.length > 0 ? { description } : {}),
    ...(draft.state ? { state: draft.state } : {}),
    ...(draft.assigneeId ? { assigneeId: ActorId.parse(draft.assigneeId) } : {}),
    ...(draft.projectId ? { projectId: ProjectId.parse(draft.projectId) } : {}),
    ...(draft.milestoneId ? { milestoneId: MilestoneId.parse(draft.milestoneId) } : {}),
    ...(draft.cycleId ? { cycleId: CycleId.parse(draft.cycleId) } : {}),
    ...(draft.startDate ? { startDate: draft.startDate } : {}),
    ...(draft.dueDate ? { dueDate: draft.dueDate } : {}),
    ...(draft.labelIds.length > 0 ? { labels: draft.labelIds.map((id) => LabelId.parse(id)) } : {}),
    ...(draft.estimate !== null ? { estimate: draft.estimate } : {}),
    ...(estimateMinutes !== null ? { estimateMinutes } : {}),
  };
}
