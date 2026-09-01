'use client';

/**
 * Typed query/mutation definitions for Athena's inbox.
 *
 * @remarks
 * Every read and write on this surface goes through the shared data layer (`apiQueryOptions` plus
 * the `useApi*` hooks), so the inbox refetches on focus, survives an offline window, and shares
 * one cache with the rest of the app. Keys are hierarchical under `['me','athena','mail']`, which
 * means a single coarse invalidation after an attach refreshes the list, the open message and its
 * attachment list together — the three things an attach actually changes.
 */
import type { AthenaMailAttachBody } from '@docket/athena/athena-mail-contract';

import { api } from '@/lib/api';
import { apiQueryOptions, STALE } from '@/lib/query-core';

/** Query key for the caller's inbox address. */
export const mailboxKey = ['me', 'athena', 'mail', 'address'] as const;
/** Query key for the caller's received messages. */
export const mailListKey = ['me', 'athena', 'mail', 'list'] as const;

/** Query key for one received message. */
export function mailMessageKey(id: string): readonly [string, string, string, string, string] {
  return ['me', 'athena', 'mail', 'message', id] as const;
}

/** Query key for one received message's attachment targets. */
export function mailAttachmentsKey(
  id: string,
): readonly [string, string, string, string, string, string] {
  return ['me', 'athena', 'mail', 'message', id, 'attachments'] as const;
}

/** The caller's Athena inbox address, minted on first read. */
export function mailboxDef() {
  return apiQueryOptions(
    mailboxKey,
    () => api.v1.me.athena.mail.address.$get(),
    'Could not load your Athena inbox address.',
    { staleTime: STALE.static },
  );
}

/** The messages Athena has received, newest first. */
export function mailListDef() {
  return apiQueryOptions(
    mailListKey,
    () => api.v1.me.athena.mail.$get({ query: {} }),
    'Could not load the messages Athena received.',
    { staleTime: STALE.volatile },
  );
}

/** One received message in full. */
export function mailMessageDef(id: string) {
  return apiQueryOptions(
    mailMessageKey(id),
    () => api.v1.me.athena.mail[':id'].$get({ param: { id } }),
    'Could not load that message.',
    { staleTime: STALE.volatile, enabled: id.length > 0 },
  );
}

/** What one received message is attached to. */
export function mailAttachmentsDef(id: string) {
  return apiQueryOptions(
    mailAttachmentsKey(id),
    () => api.v1.me.athena.mail[':id'].attachments.$get({ param: { id } }),
    'Could not load what this message is attached to.',
    { staleTime: STALE.volatile, enabled: id.length > 0 },
  );
}

/** Attach a received message to a task, project, or initiative. */
export function attachMessage(id: string, body: AthenaMailAttachBody) {
  return api.v1.me.athena.mail[':id'].attachments.$post({ param: { id }, json: body });
}

/** Detach a received message from one entity. */
export function detachMessage(id: string, attachmentId: string) {
  return api.v1.me.athena.mail[':id'].attachments[':attachmentId'].$delete({
    param: { id, attachmentId },
  });
}
