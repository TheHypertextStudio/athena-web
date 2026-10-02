/** Shared input vocabulary for direct organize calls and planning commits. */
import { z } from 'zod';
import { Health, Visibility } from '@docket/work/capability-contract';
import { InitiativeUpdateCadence } from '@docket/work/initiative-contract';
import { LabelId } from '@docket/work/ids';
import { templateDecisionFields } from '../../mcp/template-selection';
import { DESCRIPTOR_HINT } from '../../mcp/descriptors';

/** The kinds `organize` can place, outermost first — also the order they must be walked in. */
export const KINDS = ['initiative', 'program', 'project', 'milestone', 'task'] as const;
/** One placeable kind. */
export type Kind = (typeof KINDS)[number];

/** Return the owning team for label eligibility on work kinds that carry a team. */
export function labelTeamForItem(kind: Kind, teamId: string): string | null {
  return kind === 'task' || kind === 'project' ? teamId : null;
}

/**
 * The most nodes one plan may contain.
 *
 * @remarks
 * Generous enough for a real document — an initiative with a dozen projects and their tasks — and
 * small enough that the whole thing fits in one transaction without holding locks across a
 * meaningful span of time.
 */
export const MAX_ITEMS = 200;

/** One node of the plan. */
export const OrganizeItem = z.object({
  ...templateDecisionFields,
  summary: z.string().max(280).optional().describe('A short outcome summary.'),
  status: z
    .string()
    .min(1)
    .optional()
    .describe('A project, program, or initiative lifecycle status. Tasks use state.'),
  health: Health.optional(),
  visibility: Visibility.optional().describe('Project or program access scope.'),
  updateCadence: InitiativeUpdateCadence.optional(),
  labelIds: z
    .array(LabelId)
    .optional()
    .describe(
      'Explicit label IDs. Omit to inherit task template labels; an empty list suppresses defaults.',
    ),
  ref: z
    .string()
    .min(1)
    .describe(
      'A short handle you invent for this item, unique within the call, so other items can name it as their parent. Never stored.',
    ),
  kind: z.enum(KINDS).describe('What to place.'),
  title: z
    .string()
    .min(1)
    .describe('Its name or title. Also what an existing item is matched against.'),
  description: z
    .string()
    .optional()
    .describe(
      'The full Markdown body. For tasks, projects, initiatives, and programs, generally start from a relevant template of the same kind discovered through list_templates, preserve its structure, and fill its sections. The template usage summary is not the body.',
    ),
  parent: z
    .string()
    .optional()
    .describe(
      'The `ref` of another item in this call that this one sits under — a task under a project or milestone, a milestone under a project, a project under a program or initiative, a program under an initiative. To attach to something that already exists instead, use `project`/`program`/`initiative`.',
    ),
  project: z
    .string()
    .optional()
    .describe(`An existing project to file this task or milestone under. ${DESCRIPTOR_HINT}`),
  milestone: z.string().optional().describe('An existing milestone for this task.'),
  program: z
    .string()
    .optional()
    .describe(`An existing program this rolls up to. ${DESCRIPTOR_HINT}`),
  initiative: z
    .string()
    .optional()
    .describe(`An existing initiative this contributes to. ${DESCRIPTOR_HINT}`),
  assignee: z.string().optional().describe(`Who is accountable for the task. ${DESCRIPTOR_HINT}`),
  owner: z.string().optional().describe(`Who owns the program or initiative. ${DESCRIPTOR_HINT}`),
  lead: z.string().optional().describe(`Who leads the project. ${DESCRIPTOR_HINT}`),
  team: z
    .string()
    .optional()
    .describe(`The team that owns it. Defaults to the landing team. ${DESCRIPTOR_HINT}`),
  priority: z.string().optional().describe("A task's priority."),
  state: z.string().optional().describe("A task's workflow state, by key or display name."),
  dueDate: z.iso.date().optional().describe('When the task is due, as `YYYY-MM-DD`.'),
  targetDate: z.iso
    .date()
    .optional()
    .describe('The target finish for a project, milestone, or initiative, as `YYYY-MM-DD`.'),
});
/** One node of the plan. */
export type OrganizeItem = z.infer<typeof OrganizeItem>;
