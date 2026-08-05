/**
 * Project stored resource rows onto the wire.
 *
 * @remarks
 * One place decides what a client learns about a referenced resource, so the picker, the
 * hovercard, the Resources tab, and the unfurl response cannot drift into showing different
 * subsets of the same row.
 *
 * The lease and retry columns (`unfurlLeaseToken`, `unfurlAttempts`, `unfurlError`) are
 * deliberately not projected. They are how the sweep coordinates with itself, and a client that
 * could read them would start rendering our retry state as if it were the resource's state.
 */
import type { ExternalResourceOut } from '@docket/types';

import type { StoredResource } from './mention-ports';

/**
 * Project one stored resource onto its wire shape.
 *
 * @param row - The stored row.
 * @returns The client-visible resource.
 */
export function toExternalResourceOut(row: StoredResource): ExternalResourceOut {
  return {
    id: row.id as ExternalResourceOut['id'],
    organizationId: row.organizationId as ExternalResourceOut['organizationId'],
    provider: row.provider,
    canonicalKey: row.canonicalKey,
    canonicalUrl: row.canonicalUrl,
    externalId: row.externalId,
    resourceType: row.resourceType,
    title: row.title,
    description: row.description,
    siteName: row.siteName,
    iconUrl: row.iconUrl,
    thumbnailUrl: row.thumbnailUrl,
    mimeType: row.mimeType,
    ownerLabel: row.ownerLabel,
    externalUpdatedAt: row.externalUpdatedAt?.toISOString() ?? null,
    unfurlStatus: row.unfurlStatus,
    fetchedAt: row.fetchedAt?.toISOString() ?? null,
  };
}
