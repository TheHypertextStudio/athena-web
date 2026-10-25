import type { ToolboxResult } from './toolbox';
/** Trusted loop bridge: exact private tool input never enters the generally visible activity. */
import { sessionTemplateProposal, type Database } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { NotFoundError } from '../error';
import { prepareTemplateProposal } from '../mcp/template-tools';
import { templateProposalRecipient } from './template-proposal-recipient';
import { writeTemplateProposal } from './template-proposal-write';

/** Persist one template tool call through its actual session authority and canonical contracts. */
export async function persistTemplateToolProposal(
  database: Database,
  input: {
    readonly sessionId: string;
    readonly orgId: string;
    readonly toolUseId: string;
    readonly proposalGroupId: string;
    readonly raw: unknown;
    readonly execute: boolean;
  },
): Promise<void> {
  const recipient = await templateProposalRecipient(database, input.sessionId, input.orgId);
  const prepared = await prepareTemplateProposal(input.orgId, recipient.proposerActorId, input.raw);
  await writeTemplateProposal(database, { ...input, ...prepared });
}

/** Hydrate only the exact proposal attached to an already claimed action in this executor's session. */
export async function templateToolExecutionInput(
  database: Database,
  sessionId: string,
  activityId: string,
  raw: unknown,
): Promise<unknown> {
  if (!raw || typeof raw !== 'object' || !('templateProposalId' in raw)) return raw;
  const [proposal] = await database
    .select()
    .from(sessionTemplateProposal)
    .where(
      and(
        eq(sessionTemplateProposal.activityId, activityId),
        eq(sessionTemplateProposal.sessionId, sessionId),
      ),
    );
  if (!proposal || raw.templateProposalId !== proposal.activityId) throw new NotFoundError();
  return proposal.input;
}

/** Keep private definition diffs out of general activity, including structured tool presentations. */
export function templateSafeActionResult(
  tool: string,
  activityId: string,
  result: ToolboxResult,
): ToolboxResult {
  return tool === 'define_template'
    ? {
        content: JSON.stringify({ templateReview: activityId, isError: result.isError }),
        isError: result.isError,
      }
    : result;
}
