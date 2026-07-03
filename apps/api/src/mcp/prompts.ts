/**
 * `@docket/api` -- MCP server-defined prompts.
 *
 * @remarks
 * Docket exposes a small set of agent-context / system prompts via the SDK's
 * {@link McpServer.registerPrompt} so an MCP client can bootstrap a session with a
 * Docket-aware system message and a focused task brief. Prompts are PURE TEXT templates
 * (no data access, no side effects): they are parameterized by ids the caller already
 * holds and never read the DB or the verified token -- so they leak nothing and need no
 * authorization. The org/user that anchors any actual work still comes strictly from the
 * verified token's `sub` ({@link McpContext}) at tool/resource call time.
 *
 * This is the `prompts` capability the spec left as a v1 follow-up; we advertise it and
 * register the agent-context prompts here.
 */
import type { McpRegistrar } from './catalog';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { McpContext } from './auth';
import { principalDisplayName } from './principal';

/** The Docket system prompt: how an agent should operate over the Docket work model. */
const SYSTEM_PROMPT = [
  'You are an agent operating inside Docket, a multi-organization work command center.',
  '',
  'Work model (most-specific to least): Task -> Project -> Program -> Initiative, with',
  'team-scoped Cycles and project-scoped Milestones. Initiatives are cross-cutting themes',
  'that hold no work of their own. Programs are ongoing (they never complete); Projects are',
  'bounded efforts that move planned -> active -> completed (or canceled).',
  '',
  'Read entities as resources at docket://{org}/{type}/{id} and discover the orgs you can',
  'act in via docket://orgs. Make changes only through the mutation tools (create_task,',
  'update_task, set_task_state, post_update, add_comment, trigger_agent, ...). Every tool is',
  'org-scoped: pass the orgId you are acting within; you may only act in orgs you are a',
  'member of, and only with the capability the operation requires.',
  '',
  'Prefer the smallest change that accomplishes the goal. When an action needs approval, it',
  'will surface as a pending action on the session -- do not retry it as a different tool.',
  'Never fabricate ids; resolve them via search, run_view, or the resources first.',
].join('\n');

/**
 * Build a one-message prompt result carrying assistant/user text.
 *
 * @param role - The message role.
 * @param text - The message text.
 * @param description - The prompt description echoed back to the client.
 * @returns the MCP {@link GetPromptResult}.
 */
function textPrompt(
  role: 'user' | 'assistant',
  text: string,
  description: string,
): GetPromptResult {
  return { description, messages: [{ role, content: { type: 'text', text } }] };
}

/**
 * Register the Docket server-defined prompts on `server`.
 *
 * @remarks
 * `ctx` is accepted for symmetry with {@link import('./tools').registerTools} and so a
 * future prompt may personalize copy with the caller's display name; the current prompts
 * are pure templates that read no DB state.
 *
 * @param server - The per-request {@link McpServer} to register prompts on.
 * @param ctx - The authenticated MCP caller.
 */
export function registerPrompts(server: McpRegistrar, ctx: McpContext): void {
  server.registerPrompt(
    'docket_system',
    {
      title: 'Docket system prompt',
      description: 'The Docket-aware operating instructions for an agent session.',
    },
    (): GetPromptResult =>
      textPrompt(
        'assistant',
        principalDisplayName(ctx)
          ? `${SYSTEM_PROMPT}\n\nYou are acting on behalf of ${principalDisplayName(ctx)}.`
          : SYSTEM_PROMPT,
        'The Docket-aware operating instructions for an agent session.',
      ),
  );

  server.registerPrompt(
    'task_brief',
    {
      title: 'Task brief',
      description: 'A focused brief instructing an agent to work a specific Docket task.',
      argsSchema: {
        org: z.string().min(1),
        task_id: z.string().min(1),
        goal: z.string().optional(),
      },
    },
    (args): GetPromptResult => {
      const lines = [
        `Work the Docket task ${args.task_id} in organization ${args.org}.`,
        `Read its full context first: docket://${args.org}/task/${args.task_id}.`,
        args.goal ? `Goal: ${args.goal}` : 'Goal: advance the task toward its next workflow state.',
        'Use update_task / set_task_state / add_comment to record progress; do not invent ids.',
      ];
      return textPrompt('user', lines.join('\n'), 'A focused task brief.');
    },
  );

  server.registerPrompt(
    'standup',
    {
      title: 'Standup summary',
      description: 'Ask the agent to summarize recent work in an organization for a standup.',
      argsSchema: { org: z.string().min(1) },
    },
    (args): GetPromptResult =>
      textPrompt(
        'user',
        [
          `Summarize the current state of organization ${args.org} for a standup.`,
          `Use run_view (entity=task) and the portfolio resource docket://hub/portfolio to`,
          `ground the summary. Call out blocked work, at-risk projects, and pending approvals.`,
        ].join('\n'),
        'A standup summary request.',
      ),
  );
}
