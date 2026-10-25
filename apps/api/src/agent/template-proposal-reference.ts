import { ConflictError } from '../error';

/** Prevent generic input edits or approvals from bypassing the exact private template review. */
export function requireOrdinaryProposal(input: unknown): void {
  if (input && typeof input === 'object' && 'templateProposalId' in input)
    throw new ConflictError('Review this template from Inbox');
}
