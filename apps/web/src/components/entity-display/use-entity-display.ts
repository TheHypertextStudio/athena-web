'use client';

/**
 * `use-entity-display` — one query and optimistic mutation contract for native entity identity.
 *
 * @remarks
 * Icon and color are presentation records, not columns on every domain table. Keeping the query
 * keys and optimistic write here prevents each detail page from inventing a slightly different
 * cache update and guarantees that its dense-list display cache invalidates with the header.
 */
import type {
  EntityDisplayColorKey,
  EntityDisplayIconKey,
  EntityDisplayOut,
  EntityDisplaySubjectType,
} from '@docket/work/entity-display-contract';
import { defaultEntityDisplay } from '@docket/work/entity-display-contract';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

/** The persisted values the icon/color picker can change. */
export interface EntityDisplayChange {
  readonly iconKey: EntityDisplayIconKey;
  readonly colorKey: EntityDisplayColorKey;
  readonly customColor: string | null;
}

/** Inputs for {@link useEntityDisplay}. */
export interface UseEntityDisplayOptions {
  /** Organization that owns the entity. */
  readonly organizationId: string;
  /** Registry-backed native entity type. */
  readonly subjectType: EntityDisplaySubjectType;
  /** Entity id within the organization. */
  readonly subjectId: string;
  /** App-owned error copy for this entity family. */
  readonly errorMessage: string;
  /** False keeps the read dormant until a route has established that the entity exists. */
  readonly enabled?: boolean;
}

/** Read and optimistically mutate one native entity's custom identity. */
export function useEntityDisplay({
  organizationId,
  subjectType,
  subjectId,
  errorMessage,
  enabled = true,
}: UseEntityDisplayOptions) {
  const queryClient = useQueryClient();
  const displayKey = queryKeys.entityDisplay(organizationId, subjectType, subjectId);
  const query = useApiQuery(
    apiQueryOptions(
      displayKey,
      () =>
        api.v1.orgs[':orgId'].display[':subjectType'][':subjectId'].$get({
          param: { orgId: organizationId, subjectType, subjectId },
        }),
      errorMessage,
      { enabled },
    ),
  );
  const mutation = useApiMutation<
    EntityDisplayOut,
    EntityDisplayChange,
    { readonly previous: EntityDisplayOut | undefined }
  >({
    mutationFn: (json) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].display[':subjectType'][':subjectId'].$put({
            param: { orgId: organizationId, subjectType, subjectId },
            json,
          }),
        errorMessage,
      ),
    onMutate: async ({ iconKey, colorKey, customColor }) => {
      await queryClient.cancelQueries({ queryKey: displayKey });
      const previous = queryClient.getQueryData<EntityDisplayOut>(displayKey);
      queryClient.setQueryData<EntityDisplayOut>(displayKey, {
        ...(previous ?? defaultEntityDisplay(subjectType, subjectId)),
        iconKey,
        colorKey,
        customColor,
        customized: true,
      });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(displayKey, context.previous);
      } else {
        queryClient.removeQueries({ queryKey: displayKey, exact: true });
      }
    },
    invalidateKeys: [displayKey, queryKeys.entityDisplays(organizationId, subjectType)],
  });

  return {
    display: query.data ?? defaultEntityDisplay(subjectType, subjectId),
    loading: query.isPending,
    error: query.error,
    mutation,
  };
}
