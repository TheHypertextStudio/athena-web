import { z } from 'zod';

const ulid = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const ownedId = z.string().regex(ulid);
const genericOwnedId = ownedId
  .describe('A 26-char Crockford base-32 ULID matching `^[0-9A-HJKMNP-TV-Z]{26}$`.')
  .meta({ example: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });

/** Athena agent identifier. */
export const AgentId = ownedId
  .brand<'AgentId'>()
  .describe(
    'ULID id of an Agent — a configured AI worker that can be invoked to act within an org.',
  );
/** Athena agent identifier value. */
export type AgentId = z.infer<typeof AgentId>;
/** Athena agent session identifier. */
export const AgentSessionId = ownedId
  .brand<'AgentSessionId'>()
  .describe(
    'ULID id of an AgentSession — one run of an Agent, with a status lifecycle (incl. `awaiting_approval`, `failed`).',
  );
/** Athena agent session identifier value. */
export type AgentSessionId = z.infer<typeof AgentSessionId>;
/** Athena session activity identifier. */
export const SessionActivityId = ownedId
  .brand<'SessionActivityId'>()
  .describe(
    'ULID id of a SessionActivity — a single step/event recorded within an AgentSession timeline.',
  );
/** Athena session activity identifier value. */
export type SessionActivityId = z.infer<typeof SessionActivityId>;
/** Athena execution identifier. */
export const AgentExecutionId = ownedId
  .brand<'AgentExecutionId'>()
  .describe('ULID id of an AgentExecution — one exact runtime lifecycle beneath an AgentSession.');
/** Athena execution identifier value. */
export type AgentExecutionId = z.infer<typeof AgentExecutionId>;
/** Athena email suggestion identifier. */
export const EmailSuggestionId = ownedId
  .brand<'EmailSuggestionId'>()
  .describe(
    'ULID id of an EmailSuggestion — an Athena-synthesized task proposal drawn from an email thread.',
  );
/** Athena email suggestion identifier value. */
export type EmailSuggestionId = z.infer<typeof EmailSuggestionId>;
/** Athena daily digest identifier. */
export const DailyDigestId = ownedId
  .brand<'DailyDigestId'>()
  .describe("ULID id of a DailyDigest — one user's generated end-of-day summary.");
/** Athena daily digest identifier value. */
export type DailyDigestId = z.infer<typeof DailyDigestId>;

/** Personal MCP connection identifier. */
export const PersonalMcpConnectionId = genericOwnedId.brand<'PersonalMcpConnectionId'>();
/** Personal MCP connection identifier value. */
export type PersonalMcpConnectionId = z.infer<typeof PersonalMcpConnectionId>;

/** Athena assignment identifier. */
export const AthenaAssignmentId = genericOwnedId.brand<'AthenaAssignmentId'>();
/** Athena assignment identifier value. */
export type AthenaAssignmentId = z.infer<typeof AthenaAssignmentId>;

/** Athena assignment trigger identifier. */
export const AthenaTriggerId = genericOwnedId.brand<'AthenaTriggerId'>();
/** Athena assignment trigger identifier value. */
export type AthenaTriggerId = z.infer<typeof AthenaTriggerId>;
