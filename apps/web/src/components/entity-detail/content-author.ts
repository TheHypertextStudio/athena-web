/** Resolve the writer of a status post without confusing permission with authorship. */
import type { UpdateOut } from '@docket/work/update-contract';

import type { ResolveActor } from './updates-panel';

/** Name the performer when a connected agent wrote the text. */
export function contentAuthor(
  update: UpdateOut,
  resolveActor: ResolveActor,
): ReturnType<ResolveActor> {
  const origin = update.origin;
  if (!origin || origin.performerKind === 'person') return resolveActor(update.authorId);
  return {
    name:
      origin.performerName ??
      origin.clientName ??
      (origin.performerKind === 'athena'
        ? 'Athena'
        : origin.performerKind === 'docket'
          ? 'Docket'
          : 'Agent'),
    kind: 'agent',
  };
}
