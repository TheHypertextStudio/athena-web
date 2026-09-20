import { z } from 'zod';
import { actor, type db } from '@docket/db';

/** Name-only person creation shared by the roster and source-identity resolution. */
export interface CreateWorkspacePersonInput {
  readonly orgId: string;
  readonly displayName: string;
  readonly avatar?: string | null;
  /** Callers must authorize explicit access-role assignments before invoking this service. */
  readonly roleId?: string | null;
}

/** Insert an accountless person using the caller's transaction without creating access grants. */
export async function createWorkspacePerson(
  writer: Pick<typeof db, 'insert'>,
  input: CreateWorkspacePersonInput,
): Promise<typeof actor.$inferSelect> {
  const [person] = await writer
    .insert(actor)
    .values({
      organizationId: input.orgId,
      kind: 'human',
      userId: null,
      displayName: z.string().trim().min(1).max(120).parse(input.displayName),
      avatar: input.avatar ?? null,
      roleId: input.roleId ?? null,
    })
    .returning();
  if (!person) throw new Error('Person creation returned no record');
  return person;
}
