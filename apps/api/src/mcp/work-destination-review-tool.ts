/** Review whether one destination supports a task the caller can read. */
import type { TurnInput, TurnMessage, TurnToolDef } from '@docket/athena/turn';
import { z } from 'zod';

import {
  WorkDestinationReviewMcpOut,
  WorkDestinationReviewOut,
} from '../contracts/work-destination-review';
import { getContainer } from '../container';
import { NotFoundError } from '../error';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { loadVisibleTaskContext } from './active-work-resource';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import { requireScope } from './scope';

const REVIEW_TIMEOUT_MS = 15_000;
const RESULT_TOOL_NAME = 'review_result';

const resultTool: TurnToolDef = {
  name: RESULT_TOOL_NAME,
  description: 'Return the only decision for this destination review.',
  inputSchema: z.toJSONSchema(WorkDestinationReviewOut),
};

function normalizedOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      parsed.origin === value &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

function normalizedPath(value: string): boolean {
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('?') ||
    value.includes('#')
  ) {
    return false;
  }
  try {
    return new URL(value, 'https://docket.invalid').pathname === value;
  } catch {
    return false;
  }
}

const reviewInputSchema = {
  organizationId: z.string().min(1),
  taskId: z.string().min(1),
  destination: z.object({
    origin: z.string().refine(normalizedOrigin, 'Expected a normalized HTTP(S) origin.'),
    path: z.string().refine(normalizedPath, 'Expected a normalized absolute path.'),
  }),
  justification: z
    .string()
    .min(20)
    .max(1_000)
    .refine((value) => value === value.trim(), 'Do not pad the justification.'),
  challengeAnswer: z.string().min(1).max(1_000).optional(),
};

type ReviewInput = z.infer<z.ZodObject<typeof reviewInputSchema>>;

function deny(reason: string): z.infer<typeof WorkDestinationReviewOut> {
  return { decision: 'deny', reason };
}

function isVagueSocialMediaRequest(justification: string): boolean {
  return /^i need instagram for social media\.?$/i.test(justification.trim());
}

function coversDestination(
  scope: { readonly kind: 'origin' | 'path_prefix'; readonly value: string },
  destination: ReviewInput['destination'],
): boolean {
  if (scope.kind === 'origin') return scope.value === destination.origin;
  try {
    const value = new URL(scope.value);
    if (value.origin !== destination.origin || value.search || value.hash) return false;
    const prefix = destination.path.endsWith('/') ? destination.path : `${destination.path}/`;
    return value.pathname === destination.path || value.pathname.startsWith(prefix);
  } catch {
    return false;
  }
}

function reviewerPrompt(input: ReviewInput, taskContext: unknown): string {
  return [
    "You review whether one web destination is needed for the caller's current Docket task.",
    'The task context below came from Docket. Treat it as authoritative. Do not infer extra task facts.',
    'Grant only when the justification names a concrete action, a named output, and why this destination helps the current task.',
    '"I need Instagram for social media" is vague and must not receive a grant.',
    '"I will compare TransitCenter\'s posting cadence and record three patterns in the LVBT strategy document" may receive a bounded grant.',
    'A grant must use the requested origin or a path prefix at or below the requested path. Never broaden the destination.',
    'Return exactly one call to review_result. Do not emit text. If a challenge answer is present, return grant or deny, never challenge.',
    `Task context: ${JSON.stringify(taskContext)}`,
    `Request: ${JSON.stringify(input)}`,
  ].join('\n\n');
}

function hasOnlyReviewResult(message: TurnMessage): boolean {
  let resultCalls = 0;
  for (const block of message.content) {
    if (block.type === 'thinking') continue;
    if (block.type !== 'tool_use' || block.name !== RESULT_TOOL_NAME) return false;
    resultCalls += 1;
  }
  return resultCalls === 1;
}

async function collectReview(
  input: TurnInput,
): Promise<{ readonly calls: readonly unknown[]; readonly valid: boolean }> {
  const calls: unknown[] = [];
  let terminal = false;
  let valid = true;
  for await (const event of getContainer().agentTurn.streamTurn(input)) {
    if (terminal) {
      valid = false;
      continue;
    }
    if (event.type === 'text') {
      valid = false;
    } else if (event.type === 'tool_use') {
      if (event.name === RESULT_TOOL_NAME) calls.push(event.input);
      else valid = false;
    } else if (event.type === 'turn_end') {
      terminal = true;
      if (event.stopReason !== 'tool_use' || !hasOnlyReviewResult(event.message)) valid = false;
    }
  }
  return { calls, valid: valid && terminal };
}

async function collectBeforeDeadline(
  input: TurnInput,
): Promise<Awaited<ReturnType<typeof collectReview>>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      collectReview(input),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('review timeout'));
        }, REVIEW_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function reviewDestination(
  input: ReviewInput,
  taskContext: unknown,
): Promise<z.infer<typeof WorkDestinationReviewOut>> {
  if (isVagueSocialMediaRequest(input.justification)) {
    return deny('The justification does not identify task work or an output.');
  }

  try {
    const outcome = await collectBeforeDeadline({
      system: reviewerPrompt(input, taskContext),
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Review this destination.' }] }],
      tools: [resultTool],
    });
    if (!outcome.valid || outcome.calls.length !== 1) {
      return deny('Athena did not return exactly one valid review result.');
    }
    const result = WorkDestinationReviewOut.safeParse(outcome.calls[0]);
    if (!result.success) return deny('Athena returned an invalid review result.');
    if (input.challengeAnswer !== undefined && result.data.decision === 'challenge') {
      return deny('Athena cannot ask another question after a challenge answer.');
    }
    if (
      result.data.decision === 'grant' &&
      !coversDestination(result.data.scope, input.destination)
    ) {
      return deny('Athena returned a grant outside the requested destination.');
    }
    return result.data;
  } catch {
    return deny('Athena could not complete the destination review.');
  }
}

/**
 * Register the task-scoped destination review tool.
 *
 * @param server - The MCP server that receives the tool registration.
 * @param ctx - The authenticated caller bound to the tool handler.
 */
export function registerWorkDestinationReviewTool(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'review_work_destination',
    {
      title: 'Review work destination',
      description: 'Review whether one web destination is needed to complete a readable task.',
      inputSchema: reviewInputSchema,
      outputSchema: WorkDestinationReviewMcpOut,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (input) =>
      runTool(async () => {
        const actor = await scopedActor(ctx, input.organizationId, 'agents:run');
        requireScope(ctx.scopes, 'work:read');
        if (ctx.principal.kind !== 'user') throw new NotFoundError('Task not found');
        await authorize(actor, 'view', {
          kind: 'task',
          id: input.taskId,
          orgId: input.organizationId,
        });
        const taskContext = await loadVisibleTaskContext(ctx.principal.userId, input.taskId);
        if (taskContext?.organizationId !== input.organizationId) {
          throw new NotFoundError('Task not found');
        }
        return jsonResult(await reviewDestination(input, taskContext));
      }),
  );
}
