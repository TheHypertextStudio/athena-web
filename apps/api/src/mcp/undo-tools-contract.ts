/** Shared MCP Undo input contract for dispatch and exact reviewed-action comparison. */
import { z } from 'zod';
import { orgIdParam } from './tools-shared';

/** Manual human MCP may resolve the latest receipt; automated template Undo requires an exact ID. */
export const undoInputSchema = {
  orgId: orgIdParam,
  changeSetId: z
    .string()
    .optional()
    .describe('The change to reverse. Defaults to your most recent one in this workspace.'),
};

/** Parse with exactly the same transformations and defaults as the MCP registration. */
export const UndoInput = z.object(undoInputSchema);
