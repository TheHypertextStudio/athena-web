'use client';
import type {
  WorkTemplateGalleryPreviewRequest,
  WorkTemplateGalleryQuery,
  WorkTemplateGalleryAcceptRequest,
} from '@docket/work/template-gallery-contract';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, STALE, unwrap, useApiMutation } from '@/lib/query';
import { fetchAllCursorPages } from '@/lib/fetch-all-cursor-pages';

/** Complete public catalog metadata for selection restoration, through the existing cursor reader. */
export function templateGalleryAllDef(orgId: string) {
  return apiQueryOptions(
    [...queryKeys.templates(orgId), 'gallery', 'all'],
    () =>
      fetchAllCursorPages((cursor) =>
        api.v1.orgs[':orgId'].templates.definitions.gallery.$get({
          param: { orgId },
          query: { limit: '100', ...(cursor ? { cursor } : {}) },
        }),
      ),
    'Could not load the work gallery.',
    { staleTime: STALE.static },
  );
}

/** Browse released organizational work through the canonical typed transport and template cache. */
export function templateGalleryDef(
  orgId: string,
  filters: WorkTemplateGalleryQuery = {},
  cursor?: string,
) {
  return apiQueryOptions(
    [...queryKeys.templates(orgId), 'gallery', filters, cursor ?? null],
    () =>
      api.v1.orgs[':orgId'].templates.definitions.gallery.$get({
        param: { orgId },
        query: {
          ...(filters.search === undefined ? {} : { search: filters.search }),
          ...(filters.category === undefined ? {} : { category: filters.category }),
          ...(filters.fork === undefined ? {} : { fork: filters.fork }),
          ...(filters.targetType === undefined ? {} : { targetType: filters.targetType }),
          limit: '50',
          ...(cursor ? { cursor } : {}),
        },
      }),
    'Could not load the work gallery.',
    { staleTime: STALE.static },
  );
}
/** Read one actual catalog source before selecting it for the organization's work. */
export function templateGalleryEntryDef(orgId: string, slug: string) {
  return apiQueryOptions(
    [...queryKeys.templates(orgId), 'gallery', 'entry', slug],
    () =>
      api.v1.orgs[':orgId'].templates.definitions.gallery[':slug'].$get({ param: { orgId, slug } }),
    'Could not load this work definition.',
    { staleTime: STALE.static },
  );
}
/** Request a read-only checked copy review; this mutation allocates no identities and writes nothing. */
export function useTemplateGalleryPreview(orgId: string) {
  return useApiMutation({
    mutationFn: (input: WorkTemplateGalleryPreviewRequest) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].templates.definitions.gallery['copy-preview'].$post({
            param: { orgId },
            json: input,
          }),
        'Could not review these work definitions.',
      ),
  });
}

/** Resolve complete approved fork membership independently of browse filters or loaded pages. */
export function templateGalleryForkDef(
  orgId: string,
  fork: 'startup' | 'nonprofit' | 'agency' | 'personal',
) {
  return apiQueryOptions(
    [...queryKeys.templates(orgId), 'gallery', 'fork', fork],
    () =>
      api.v1.orgs[':orgId'].templates.definitions.gallery.forks[':fork'].$get({
        param: { orgId, fork },
      }),
    'Could not load these starting points.',
    { staleTime: STALE.static },
  );
}

/** Accept only the exact checked choices; transport retries retain their original request identity. */
export function useTemplateGalleryAccept(orgId: string) {
  return useApiMutation({
    mutationFn: (input: WorkTemplateGalleryAcceptRequest) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].templates.definitions.gallery.copies.$post({
            param: { orgId },
            json: input,
          }),
        'Could not save these work definitions.',
      ),
    invalidateKeys: [queryKeys.templates(orgId)],
  });
}

/** Reconcile the original actual outcome without requiring authoring rights or repeating source reads. */
export function templateGalleryCopyStatusDef(orgId: string, requestId: string) {
  return apiQueryOptions(
    [...queryKeys.templates(orgId), 'gallery', 'request', requestId],
    () =>
      api.v1.orgs[':orgId'].templates.definitions.gallery.copies.requests[':requestId'].$get({
        param: { orgId, requestId },
      }),
    'Could not check whether these definitions were saved.',
    { staleTime: 0 },
  );
}

/** Reopen saved copies from current authorized canonical drafts, including honest pending reservations. */
export function templateGalleryCopyBundleDef(orgId: string, bundleId: string) {
  return apiQueryOptions(
    [...queryKeys.templates(orgId), 'gallery', 'bundle', bundleId],
    () =>
      api.v1.orgs[':orgId'].templates.definitions.gallery.copies[':bundleId'].$get({
        param: { orgId, bundleId },
      }),
    'Could not open these saved work definitions.',
  );
}

/** Reverse the actual copy receipt, retaining later authored edits and used definitions. */
export function useTemplateGalleryCopyUndo(orgId: string) {
  return useApiMutation({
    mutationFn: (input: { readonly bundleId: string }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].templates.definitions.gallery.copies[':bundleId'].undo.$post({
            param: { orgId, bundleId: input.bundleId },
          }),
        'Could not undo this copy.',
      ),
    invalidateKeys: [queryKeys.templates(orgId)],
  });
}
