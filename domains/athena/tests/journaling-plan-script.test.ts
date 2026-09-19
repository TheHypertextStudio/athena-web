import { describe, expect, it } from 'vitest';

import {
  JOURNALING_PLAN_ROLES,
  SCRIPT_ORG_ID,
  SCRIPT_PLAN_ID,
  bindJournalingPlanTurns,
} from '../src/turn/internal/journaling-plan-script';
import {
  JOURNALING_PLAN_TURNS,
  MockAgentTurnRuntime,
  SCRIPTED_TASK_ID,
  SCRIPTED_TURNS,
  type TurnEvent,
  type TurnMessage,
  type TurnSubjectTask,
} from '../src/turn/turn';

const ORG = '01J0000000000000000000ORG1';
const PLAN = 'plan-1';
const PRODUCT = 'team-product';
const ENGINEERING = 'team-eng';

/** A tool result block carrying `value` as JSON. */
function toolResult(id: string, value: unknown): TurnMessage {
  return {
    role: 'user',
    content: [
      { type: 'tool_result', toolUseId: id, content: JSON.stringify(value), isError: false },
    ],
  };
}

/** The transcript after `workspaces` and `plan_start` have both answered. */
function transcriptAfterStart(): TurnMessage[] {
  return [
    { role: 'user', content: [{ type: 'text', text: 'Plan the journaling launch' }] },
    toolResult('toolu_mock_jp00', { workspaces: [{ id: ORG, name: 'Acme' }] }),
    toolResult('toolu_mock_jp01', {
      planId: PLAN,
      revision: 3,
      people: [
        { actorId: 'ana', name: 'Ana', teamIds: [PRODUCT] },
        { actorId: 'bo', name: 'Bo', teamIds: [ENGINEERING] },
        { actorId: 'cy', name: 'Cy', teamIds: [PRODUCT] },
        { actorId: 'di', name: 'Di', teamIds: [ENGINEERING] },
        { actorId: 'ed', name: 'Ed', teamIds: [ENGINEERING] },
      ],
      teams: [
        { id: PRODUCT, name: 'Product' },
        { id: ENGINEERING, name: 'Engineering' },
      ],
    }),
  ];
}

/** Every tool input the bound script would send, by tool name, in order. */
function toolInputs(messages: readonly TurnMessage[]): { name: string; input: unknown }[] {
  return bindJournalingPlanTurns(messages).flatMap((turn) =>
    turn.message.content.flatMap((block) =>
      block.type === 'tool_use' ? [{ name: block.name, input: block.input }] : [],
    ),
  );
}

/** The `upsert_node` nodes of every drafting call. */
function draftedNodes(messages: readonly TurnMessage[]): Record<string, unknown>[] {
  return toolInputs(messages)
    .filter((call) => call.name === 'plan_draft')
    .flatMap((call) => (call.input as { ops: { node: Record<string, unknown> }[] }).ops)
    .map((op) => op.node);
}

describe('journaling planning script', () => {
  it('drafts one initiative, three projects, and feature tasks each carrying subtasks', () => {
    const nodes = draftedNodes([]);
    const kinds = nodes.map((node) => node['kind']);
    expect(kinds.filter((kind) => kind === 'initiative')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'project')).toHaveLength(3);

    const refs = new Set(nodes.map((node) => node['ref']));
    for (const node of nodes) {
      if (node['kind'] === 'initiative') continue;
      expect(refs.has(node['parentRef'])).toBe(true);
    }
    const subtasks = nodes.filter(
      (node) => JOURNALING_PLAN_ROLES.get(node['ref'] as string) === 'engineering',
    );
    expect(subtasks.length).toBeGreaterThan(0);
  });

  it('keeps its sentinels when nothing has answered yet', () => {
    const calls = toolInputs([]);
    expect(calls.find((call) => call.name === 'plan_start')?.input).toMatchObject({
      orgId: SCRIPT_ORG_ID,
    });
    expect(calls.find((call) => call.name === 'plan_draft')?.input).toMatchObject({
      planId: SCRIPT_PLAN_ID,
    });
  });

  it('binds the workspace, plan, and revision the earlier calls returned', () => {
    const calls = toolInputs(transcriptAfterStart());
    expect(calls.find((call) => call.name === 'plan_start')?.input).toMatchObject({ orgId: ORG });
    for (const call of calls.filter((entry) => entry.name === 'plan_draft')) {
      expect(call.input).toMatchObject({ planId: PLAN, revision: 3 });
    }
  });

  it('assigns feature tasks within product and subtasks within engineering', () => {
    const product = new Set(['ana', 'cy']);
    const engineering = new Set(['bo', 'di', 'ed']);
    for (const node of draftedNodes(transcriptAfterStart())) {
      const role = JOURNALING_PLAN_ROLES.get(node['ref'] as string);
      if (role === undefined) continue;
      const fields = node['fields'] as { teamId: string; assigneeId: string };
      const team = role === 'product' ? product : engineering;
      expect(fields.teamId).toBe(role === 'product' ? PRODUCT : ENGINEERING);
      expect(team.has(fields.assigneeId)).toBe(true);
    }
  });

  it('deals each team its work round-robin in script order', () => {
    const assignees = (role: 'product' | 'engineering'): string[] =>
      draftedNodes(transcriptAfterStart())
        .filter((node) => JOURNALING_PLAN_ROLES.get(node['ref'] as string) === role)
        .map((node) => (node['fields'] as { assigneeId: string }).assigneeId);

    const product = assignees('product');
    const engineering = assignees('engineering');
    expect(product).toEqual(product.map((_, index) => ['ana', 'cy'][index % 2]));
    expect(engineering).toEqual(engineering.map((_, index) => ['bo', 'di', 'ed'][index % 3]));
    // Every member of each team receives work, which is the point of the spread.
    expect(new Set(product)).toEqual(new Set(['ana', 'cy']));
    expect(new Set(engineering)).toEqual(new Set(['bo', 'di', 'ed']));
  });

  it('leaves work unassigned when the roster has no teams', () => {
    const transcript = transcriptAfterStart().slice(0, 2);
    transcript.push(toolResult('toolu_mock_jp01', { planId: PLAN, revision: 0 }));
    for (const node of draftedNodes(transcript)) {
      if (!JOURNALING_PLAN_ROLES.has(node['ref'] as string)) continue;
      expect(node['fields']).toMatchObject({ teamId: null, assigneeId: null });
    }
  });
});

describe('MockAgentTurnRuntime script choice', () => {
  /** The tool the first streamed turn calls, if any. */
  async function firstToolName(text: string): Promise<string | undefined> {
    const runtime = new MockAgentTurnRuntime();
    const events: TurnEvent[] = [];
    for await (const event of runtime.streamTurn({
      system: '',
      messages: [{ role: 'user', content: [{ type: 'text', text }] }],
      tools: [],
    })) {
      events.push(event);
    }
    const done = events.find((event) => event.type === 'turn_end');
    const message = done && 'message' in done ? done.message : undefined;
    return message?.content.find((block) => block.type === 'tool_use')?.name;
  }

  /** The tool the first turn of a script calls. */
  function scriptedFirstTool(script: typeof SCRIPTED_TURNS): string | undefined {
    const block = script[0]?.message.content.find((entry) => entry.type === 'tool_use');
    return block?.type === 'tool_use' ? block.name : undefined;
  }

  it('runs the planning script when asked to plan a journaling launch', async () => {
    await expect(firstToolName('  Plan a journaling launch')).resolves.toBe(
      scriptedFirstTool(JOURNALING_PLAN_TURNS),
    );
  });

  it('runs the default script otherwise', async () => {
    await expect(firstToolName('Plan my day.')).resolves.toBe(scriptedFirstTool(SCRIPTED_TURNS));
  });

  /** The input of the first streamed turn's tool call, when the turn names a subject task. */
  async function firstToolCall(subjectTask: TurnSubjectTask): Promise<unknown> {
    const runtime = new MockAgentTurnRuntime();
    for await (const event of runtime.streamTurn({
      system: '',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Start this.' }] }],
      tools: [],
      subjectTask,
    })) {
      if (event.type === 'tool_use') return { name: event.name, input: event.input };
    }
    return undefined;
  }

  it('aims the default script at the turn’s subject task', async () => {
    const subject = { id: '01J00000000000000000TASK01', organizationId: ORG };
    await expect(firstToolCall(subject)).resolves.toEqual({
      name: 'update',
      input: {
        orgId: ORG,
        entity: 'task',
        scope: { ids: [subject.id] },
        set: { state: 'in_progress' },
      },
    });
    const defaultUse = SCRIPTED_TURNS[0]?.message.content.find(
      (block) => block.type === 'tool_use',
    );
    expect(defaultUse).toMatchObject({ input: { taskId: SCRIPTED_TASK_ID } });
  });
});
