import type { UpdateAuthorReference } from '@docket/work/update-contract';

interface UpdateActor {
  readonly name: string;
  readonly kind: UpdateAuthorReference['kind'];
}

/** Resolve a feed's bounded named authors, with its known lead as a legacy fallback. */
export function updateActorResolver(
  authors: readonly UpdateAuthorReference[] | undefined,
  lead: { readonly actorId: string; readonly displayName: string } | null | undefined,
): (actorId: string | null | undefined) => UpdateActor {
  return (actorId) => {
    const author = authors?.find((candidate) => candidate.actorId === actorId);
    if (author) return { name: author.displayName, kind: author.kind };
    return { name: lead && lead.actorId === actorId ? lead.displayName : 'Unknown', kind: 'human' };
  };
}
