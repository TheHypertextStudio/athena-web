/**
 * The scripted planning conversation the mock runtime replays for a journaling-app launch.
 *
 * @remarks
 * A demonstration of the planning canvas that needs no model behind it: `workspaces` to learn the
 * id every other tool wants, `plan_start` to open the canvas, one `plan_draft` batch per feature so
 * the canvas fills in a feature at a time, and a closing line inviting the person to confirm.
 *
 * The script is stored unbound. Its tool inputs carry sentinel ids, because a constant written
 * months before any workspace existed cannot name one, and {@link bindJournalingPlanTurns} swaps
 * them for the ids the earlier calls actually returned before the turn is replayed. The same pass
 * fills `assigneeId` and `teamId` from the roster `plan_start` returned: feature tasks go to the
 * product team and engineering subtasks to the engineering team, dealt round-robin across each
 * team's members in script order so the demo spreads the work. When the roster names nobody who
 * fits, both stay null — a wrong assignee is worse than none.
 */
import type { TurnMessage } from '../../turn-protocol';
import type { ScriptedTurn } from '../turn';

/** The workspace id the unbound script carries; ULID-shaped so it satisfies the tool schema. */
export const SCRIPT_ORG_ID = '00000000000000000000000000';

/** The plan id the unbound script carries. */
export const SCRIPT_PLAN_ID = 'scripted-plan';

/** Which kind of team a scripted node's work belongs to. */
export type ScriptRole = 'product' | 'engineering';

/** One engineering subtask under a feature task. */
interface ScriptSubtask {
  readonly ref: string;
  readonly title: string;
}

/** One user story, drafted as a feature task carrying its engineering work. */
interface ScriptFeature {
  readonly ref: string;
  readonly title: string;
  readonly subtasks: readonly ScriptSubtask[];
}

/** One feature area, drafted as a project with its user stories inside it. */
interface ScriptFeatureArea {
  readonly ref: string;
  readonly title: string;
  readonly features: readonly ScriptFeature[];
}

/** The initiative every batch hangs from. */
const INITIATIVE = { ref: 'launch', title: 'Journaling app feature launch' } as const;

/** The three feature areas, one per drafting turn. */
const FEATURE_AREAS: readonly ScriptFeatureArea[] = [
  {
    ref: 'mood',
    title: 'Mood tracking',
    features: [
      {
        ref: 'mood-log',
        title: 'Log how I feel alongside an entry',
        subtasks: [
          { ref: 'mood-log-model', title: 'Add the mood column and its migration' },
          { ref: 'mood-log-ui', title: 'Build the mood picker on the entry composer' },
        ],
      },
      {
        ref: 'mood-trend',
        title: 'See how my mood moved over the month',
        subtasks: [
          { ref: 'mood-trend-query', title: 'Aggregate moods by day behind an endpoint' },
          { ref: 'mood-trend-chart', title: 'Draw the month trend on the insights screen' },
        ],
      },
    ],
  },
  {
    ref: 'prompts',
    title: 'Prompts',
    features: [
      {
        ref: 'prompt-daily',
        title: 'Get a prompt when I open a blank entry',
        subtasks: [
          { ref: 'prompt-daily-catalog', title: 'Seed the prompt catalog and its rotation' },
          { ref: 'prompt-daily-ui', title: 'Show the prompt above the empty composer' },
        ],
      },
      {
        ref: 'prompt-skip',
        title: 'Skip a prompt that does not fit today',
        subtasks: [
          { ref: 'prompt-skip-api', title: 'Record a skip and pick the next prompt' },
          { ref: 'prompt-skip-ui', title: 'Add the skip control and its undo' },
        ],
      },
      {
        ref: 'prompt-themes',
        title: 'Choose the themes my prompts come from',
        subtasks: [
          { ref: 'prompt-themes-model', title: 'Store per-person theme preferences' },
          { ref: 'prompt-themes-ui', title: 'Build the theme picker in settings' },
        ],
      },
    ],
  },
  {
    ref: 'weekly',
    title: 'Weekly reflection',
    features: [
      {
        ref: 'weekly-digest',
        title: 'Read a weekly digest of what I wrote',
        subtasks: [
          { ref: 'weekly-digest-job', title: 'Assemble the weekly digest on a schedule' },
          { ref: 'weekly-digest-ui', title: 'Lay out the digest screen' },
        ],
      },
      {
        ref: 'weekly-reminder',
        title: 'Be reminded to reflect at the end of the week',
        subtasks: [
          { ref: 'weekly-reminder-send', title: 'Send the reflection reminder' },
          { ref: 'weekly-reminder-prefs', title: 'Let the day and time be changed' },
        ],
      },
    ],
  },
];

/**
 * Which roster to draw each node's assignee from.
 *
 * @remarks
 * Exported so the binder and its tests read the same table rather than re-deriving the rule from
 * the ref naming, which would make a typo in a ref silently unassign a node.
 */
export const JOURNALING_PLAN_ROLES: ReadonlyMap<string, ScriptRole> = new Map(
  FEATURE_AREAS.flatMap((area) =>
    area.features.flatMap((feature): [string, ScriptRole][] => [
      [feature.ref, 'product'],
      ...feature.subtasks.map((subtask): [string, ScriptRole] => [subtask.ref, 'engineering']),
    ]),
  ),
);

/** One `upsert_node` op, with the assignment fields left for the binder to fill. */
function upsert(
  ref: string,
  kind: 'initiative' | 'project' | 'task',
  parentRef: string | null,
  title: string,
): Record<string, unknown> {
  return {
    op: 'upsert_node',
    node: {
      ref,
      kind,
      ...(parentRef === null ? {} : { parentRef }),
      fields: { title, ...(kind === 'task' ? { assigneeId: null, teamId: null } : {}) },
    },
  };
}

/** The ops for one feature area: its project, its feature tasks, and their subtasks. */
function areaOps(area: ScriptFeatureArea, withInitiative: boolean): Record<string, unknown>[] {
  return [
    ...(withInitiative ? [upsert(INITIATIVE.ref, 'initiative', null, INITIATIVE.title)] : []),
    upsert(area.ref, 'project', INITIATIVE.ref, area.title),
    ...area.features.flatMap((feature) => [
      upsert(feature.ref, 'task', area.ref, feature.title),
      ...feature.subtasks.map((subtask) => upsert(subtask.ref, 'task', feature.ref, subtask.title)),
    ]),
  ];
}

/** One assistant turn that calls a single tool. */
function toolTurn(id: string, name: string, input: Record<string, unknown>): ScriptedTurn {
  return {
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
    stopReason: 'tool_use',
  };
}

/**
 * The unbound journaling-plan script: discover the workspace, open the plan, draft three features,
 * and hand the canvas back.
 *
 * @remarks
 * Replay it through {@link bindJournalingPlanTurns}, never directly — the ids here are sentinels.
 */
export const JOURNALING_PLAN_TURNS: readonly ScriptedTurn[] = [
  {
    message: {
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking: 'Finding the workspace before opening a plan in it.',
          signature: 'mock-sig-journal-0',
        },
        { type: 'tool_use', id: 'toolu_mock_jp00', name: 'workspaces', input: {} },
      ],
    },
    stopReason: 'tool_use',
  },
  toolTurn('toolu_mock_jp01', 'plan_start', {
    orgId: SCRIPT_ORG_ID,
    title: INITIATIVE.title,
  }),
  ...FEATURE_AREAS.map((area, index) =>
    toolTurn(`toolu_mock_jp1${String(index)}`, 'plan_draft', {
      planId: SCRIPT_PLAN_ID,
      revision: 0,
      ops: areaOps(area, index === 0),
    }),
  ),
  {
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Three features drafted. Confirm when ready.' }],
    },
    stopReason: 'end_turn',
  },
];

/** One person the roster named, as the plan tools return them. */
interface RosterPerson {
  readonly actorId: string;
  readonly teamIds: readonly string[];
}

/** What the earlier tool calls in this conversation told the script. */
interface ScriptContext {
  readonly orgId: string;
  readonly planId: string;
  readonly revision: number;
  readonly people: readonly RosterPerson[];
  readonly teams: readonly { readonly id: string; readonly name: string }[];
}

/** Every JSON tool result in the transcript, oldest first; unparseable results are skipped. */
function toolResults(messages: readonly TurnMessage[]): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== 'tool_result' || block.isError) continue;
      try {
        const parsed: unknown = JSON.parse(block.content);
        if (parsed !== null && typeof parsed === 'object') {
          results.push(parsed as Record<string, unknown>);
        }
      } catch {
        // A tool that answered in prose tells the script nothing; the sentinels stay.
      }
    }
  }
  return results;
}

/** The first workspace id any `workspaces` result carried. */
function orgIdFrom(results: readonly Record<string, unknown>[]): string {
  for (const result of results) {
    const workspaces = result['workspaces'];
    if (!Array.isArray(workspaces)) continue;
    const first: unknown = workspaces[0];
    if (
      first !== null &&
      typeof first === 'object' &&
      typeof Reflect.get(first, 'id') === 'string'
    ) {
      return Reflect.get(first, 'id') as string;
    }
  }
  return SCRIPT_ORG_ID;
}

/** The roster and plan state the most recent plan tool result reported. */
function planStateFrom(results: readonly Record<string, unknown>[]): Omit<ScriptContext, 'orgId'> {
  let state: Omit<ScriptContext, 'orgId'> = {
    planId: SCRIPT_PLAN_ID,
    revision: 0,
    people: [],
    teams: [],
  };
  for (const result of results) {
    const planId = result['planId'];
    if (typeof planId !== 'string') continue;
    state = {
      planId,
      revision: typeof result['revision'] === 'number' ? result['revision'] : state.revision,
      people: Array.isArray(result['people']) ? (result['people'] as RosterPerson[]) : state.people,
      teams: Array.isArray(result['teams'])
        ? (result['teams'] as ScriptContext['teams'])
        : state.teams,
    };
  }
  return state;
}

/** The team whose name reads as that role's, or the only team there is. */
function teamFor(context: ScriptContext, role: ScriptRole): string | null {
  const keyword = role === 'product' ? 'product' : 'engineer';
  const named = context.teams.find((team) => team.name.toLowerCase().includes(keyword));
  return named?.id ?? context.teams[0]?.id ?? null;
}

/**
 * Each node's position among the nodes of its role, in script order.
 *
 * @remarks
 * The binder runs once per replayed turn with a fresh context, so the round-robin slot has to be a
 * property of the node rather than a counter carried between calls.
 */
const JOURNALING_PLAN_SLOTS: ReadonlyMap<string, number> = slotsByRole();

/** Number every ref within its role, starting from zero. */
function slotsByRole(): ReadonlyMap<string, number> {
  const next = new Map<ScriptRole, number>();
  const slots = new Map<string, number>();
  for (const [ref, role] of JOURNALING_PLAN_ROLES) {
    const slot = next.get(role) ?? 0;
    slots.set(ref, slot);
    next.set(role, slot + 1);
  }
  return slots;
}

/** The team member whose turn it is for that slot, or nobody when the team is empty. */
function assigneeFor(context: ScriptContext, teamId: string | null, slot: number): string | null {
  if (teamId === null) return null;
  const members = context.people.filter((person) => person.teamIds.includes(teamId));
  if (members.length === 0) return null;
  return members[slot % members.length]?.actorId ?? null;
}

/** One op with the sentinel assignment fields replaced by real ids, when the node takes them. */
function boundOp(op: Record<string, unknown>, context: ScriptContext): Record<string, unknown> {
  const node = op['node'];
  if (op['op'] !== 'upsert_node' || node === null || typeof node !== 'object') return op;
  const ref: unknown = Reflect.get(node, 'ref');
  if (typeof ref !== 'string') return op;
  const role = JOURNALING_PLAN_ROLES.get(ref);
  if (role === undefined) return op;
  const teamId = teamFor(context, role);
  const fields: unknown = Reflect.get(node, 'fields');
  return {
    ...op,
    node: {
      ...(node as Record<string, unknown>),
      fields: {
        ...(fields as Record<string, unknown>),
        assigneeId: assigneeFor(context, teamId, JOURNALING_PLAN_SLOTS.get(ref) ?? 0),
        teamId,
      },
    },
  };
}

/** One tool input with every sentinel replaced by what the earlier calls returned. */
function boundInput(name: string, input: unknown, context: ScriptContext): unknown {
  if (input === null || typeof input !== 'object') return input;
  const source = input as Record<string, unknown>;
  if (name === 'plan_start') return { ...source, orgId: context.orgId };
  if (name !== 'plan_draft') return source;
  const ops = Array.isArray(source['ops']) ? (source['ops'] as Record<string, unknown>[]) : [];
  return {
    ...source,
    planId: context.planId,
    revision: context.revision,
    ops: ops.map((op) => boundOp(op, context)),
  };
}

/**
 * The journaling script with its sentinels resolved against what the conversation already knows.
 *
 * @param messages - The durable transcript so far, tool results included.
 * @returns the same turns, ready to replay.
 */
export function bindJournalingPlanTurns(messages: readonly TurnMessage[]): readonly ScriptedTurn[] {
  const results = toolResults(messages);
  const context: ScriptContext = { orgId: orgIdFrom(results), ...planStateFrom(results) };
  return JOURNALING_PLAN_TURNS.map((turn) => ({
    ...turn,
    message: {
      ...turn.message,
      content: turn.message.content.map((block) =>
        block.type === 'tool_use'
          ? { ...block, input: boundInput(block.name, block.input, context) }
          : block,
      ),
    },
  }));
}
