'use client';

/**
 * Read the references one entity's prose points at.
 *
 * @remarks
 * Derived server-side from the entity's stored Markdown, so this needs no invalidation wiring of
 * its own beyond the description's own save: the reconciler runs on that write, and the standard
 * staleness tier picks the change up.
 */
import type { EntityMention, MentionSubjectType } from './contracts/mention';
import type { SubjectRef } from '@docket/work/subject-ref-contract';
import type { TeamId } from '@docket/identity-access/ids';

import { api } from './api';
import { apiQueryOptions, queryKeys, STALE, useApiQuery } from './query';

/** The route segment each mentionable subject is mounted under. */
const SUBJECT_PATH: Partial<
  Record<MentionSubjectType, 'projects' | 'tasks' | 'initiatives' | 'programs' | 'teams'>
> = {
  project: 'projects',
  task: 'tasks',
  initiative: 'initiatives',
  program: 'programs',
  team: 'teams',
};

/** What an entity's prose points at, plus the read's state. */
export interface EntityMentionsData {
  /** References to things outside Docket. */
  readonly external: readonly EntityMention[];
  /** References to other Docket records. */
  readonly entities: readonly EntityMention[];
  /** True while the first load is in flight. */
  readonly isPending: boolean;
}

/** A mention-bearing subject with its type correlated to its branded identifier. */
export type EntityMentionSubjectRef =
  | Extract<SubjectRef, { readonly subjectType: MentionSubjectType }>
  | { readonly subjectType: 'team'; readonly subjectId: TeamId };

/**
 * Read the derived references for one entity.
 *
 * @param orgId - The workspace the entity belongs to.
 * @param subject - The correlated kind and branded identifier of the record.
 * @returns The references, split by what they point at.
 */
export function useEntityMentions(
  orgId: string,
  subject: EntityMentionSubjectRef,
  enabled = true,
): EntityMentionsData {
  const { subjectType, subjectId } = subject;
  const segment = SUBJECT_PATH[subjectType];

  const query = useApiQuery(
    apiQueryOptions<{ external: EntityMention[]; entities: EntityMention[] }>(
      queryKeys.entityMentions(orgId, subjectType, subjectId),
      () =>
        api.v1.orgs[':orgId'][segment ?? 'projects'][':id'].mentions.$get({
          param: { orgId, id: subjectId },
        }),
      'Could not load what this record references.',
      { enabled: enabled && segment !== undefined, staleTime: STALE.standard },
    ),
  );

  return {
    external: query.data?.external ?? [],
    entities: query.data?.entities ?? [],
    isPending: enabled && segment !== undefined && query.isPending,
  };
}
