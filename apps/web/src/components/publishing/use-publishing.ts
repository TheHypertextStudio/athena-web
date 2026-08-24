'use client';

/**
 * `publishing` — the typed reads and writes behind every publishing surface.
 *
 * @remarks
 * One module so the publish button on a detail header and the publishing settings page share
 * exactly one cache. They must: publishing a brief changes what the settings list shows, and
 * adding a custom domain changes the URLs the detail header prints. Both effects fall out of the
 * shared `['org', orgId, 'publishing', …]` key prefix rather than from either surface knowing
 * the other exists.
 *
 * The workspace's default brief address is its own identity slug (`organization.slug`). It is
 * renamed here too — every address the workspace answers on is one list on one surface, so the
 * write that renames the default sits beside the writes that add and verify the custom ones.
 *
 * Every call goes through the typed RPC client and the shared query layer — no hand-rolled
 * `useEffect` + `fetch`, per the data-layer standard.
 */
import type {
  OrgOut,
  PublicationOut,
  PublicationSubjectKind,
  WorkspaceDomainOut,
  WorkspaceDomainVerifyOut,
} from '@docket/types';

import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, unwrap, useApiQuery, useApiMutation } from '@/lib/query';

/** The publication state of one record, or `null` when it has never been published. */
export interface PublicationState {
  /** The publication, or `null` when the record has never been published. */
  readonly publication: PublicationOut | null;
  /** The only resolved state a deferred publishing dialog may use for its actions. */
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  /** Retry a failed publication-state read without closing the dialog. */
  readonly retry: () => void;
}

/**
 * Read one record's publication state.
 *
 * @param orgId - The active workspace.
 * @param subjectKind - Which kind of record.
 * @param subjectId - The record id.
 * @param enabled - Whether the publishing surface is open and needs this optional state.
 * @returns The resolved {@link PublicationState}.
 */
export function usePublicationState(
  orgId: string,
  subjectKind: PublicationSubjectKind,
  subjectId: string,
  enabled = true,
): PublicationState {
  const query = useApiQuery(
    apiQueryOptions(
      queryKeys.publication(orgId, subjectKind, subjectId),
      () =>
        api.v1.orgs[':orgId'].publications[':subjectKind'][':subjectId'].$get({
          param: { orgId, subjectKind, subjectId },
        }),
      'Could not load publishing status.',
      { enabled },
    ),
  );
  return {
    publication: query.data?.publication ?? null,
    status: !enabled ? 'idle' : query.isPending ? 'loading' : query.isError ? 'error' : 'ready',
    retry: () => {
      void query.refetch();
    },
  };
}

/** Publish (or re-publish) a record, optionally at a chosen address. */
export function usePublishMutation(orgId: string) {
  return useApiMutation<
    PublicationOut,
    { subjectKind: PublicationSubjectKind; subjectId: string; slug?: string }
  >({
    mutationFn: (input) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].publications.$post({
            param: { orgId },
            json: {
              subjectKind: input.subjectKind,
              subjectId: input.subjectId,
              ...(input.slug === undefined ? {} : { slug: input.slug }),
            },
          }),
        'Could not publish this page.',
      ),
    invalidateKeys: [queryKeys.publications(orgId)],
  });
}

/** Withdraw a published brief; the row and its address are retained. */
export function useWithdrawMutation(orgId: string) {
  return useApiMutation<PublicationOut, string>({
    mutationFn: (publicationId) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].publications[':id'].$delete({
            param: { orgId, id: publicationId },
          }),
        'Could not unpublish this page.',
      ),
    invalidateKeys: [queryKeys.publications(orgId)],
  });
}

/** Move a published brief to a different address. */
export function useMoveBriefMutation(orgId: string) {
  return useApiMutation<PublicationOut, { publicationId: string; slug: string }>({
    mutationFn: ({ publicationId, slug }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].publications[':id'].$patch({
            param: { orgId, id: publicationId },
            json: { slug },
          }),
        'Could not change this page’s address.',
      ),
    invalidateKeys: [queryKeys.publications(orgId)],
  });
}

/** Every publication in the workspace, for the settings list. */
export function usePublicationsQuery(orgId: string, enabled: boolean) {
  return useApiQuery(
    apiQueryOptions(
      queryKeys.publications(orgId),
      () => api.v1.orgs[':orgId'].publications.$get({ param: { orgId } }),
      'Could not load published pages.',
      { enabled },
    ),
  );
}

/**
 * Rename the workspace's default published address.
 *
 * @remarks
 * The slug is the workspace's one public identity, and every address the workspace answers on is
 * listed and edited on the publishing surface — so the write lives here beside the domain writes
 * rather than in a general-settings form that happened to own the field first.
 *
 * @param orgId - The workspace being renamed.
 * @returns The rename mutation.
 */
export function useRenameAddressMutation(orgId: string) {
  return useApiMutation<OrgOut, string>({
    mutationFn: (slug) =>
      unwrap(
        () => api.v1.orgs[':orgId'].$patch({ param: { orgId }, json: { slug } }),
        'Could not change this address.',
      ),
    invalidateKeys: [queryKeys.organization(orgId), queryKeys.orgs(), ['org', orgId, 'publishing']],
  });
}

/** Every custom domain claimed by the workspace. */
export function useWorkspaceDomainsQuery(orgId: string, enabled: boolean) {
  return useApiQuery(
    apiQueryOptions(
      queryKeys.workspaceDomains(orgId),
      () => api.v1.orgs[':orgId'].publishing.domains.$get({ param: { orgId } }),
      'Could not load custom domains.',
      { enabled },
    ),
  );
}

/** Claim a custom domain for the workspace. */
export function useAddDomainMutation(orgId: string) {
  return useApiMutation<WorkspaceDomainOut, string>({
    mutationFn: (host) =>
      unwrap(
        () => api.v1.orgs[':orgId'].publishing.domains.$post({ param: { orgId }, json: { host } }),
        'Could not add this domain.',
      ),
    invalidateKeys: [['org', orgId, 'publishing']],
  });
}

/** Re-check a domain's DNS ownership record. */
export function useVerifyDomainMutation(orgId: string) {
  return useApiMutation<WorkspaceDomainVerifyOut, string>({
    mutationFn: (id) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].publishing.domains[':id'].verify.$post({ param: { orgId, id } }),
        'Could not check this domain.',
      ),
    invalidateKeys: [['org', orgId, 'publishing']],
  });
}

/** Release a custom domain. */
export function useRemoveDomainMutation(orgId: string) {
  return useApiMutation<WorkspaceDomainOut, string>({
    mutationFn: (id) =>
      unwrap(
        () => api.v1.orgs[':orgId'].publishing.domains[':id'].$delete({ param: { orgId, id } }),
        'Could not remove this domain.',
      ),
    invalidateKeys: [['org', orgId, 'publishing']],
  });
}
