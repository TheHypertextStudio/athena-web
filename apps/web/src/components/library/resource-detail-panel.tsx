'use client';

/**
 * One Library entry, opened in place: what it is, where it lives, and what points at it.
 *
 * @remarks
 * This is what `/orgs/:orgId/library?resourceId=…` resolves to — the route `entityHref` hands out
 * for an external resource and the one the command palette navigates to. Without it those are
 * dangling references that land on an unchanged list.
 *
 * The reason it exists rather than sending the reader straight to the provider is the backlinks.
 * "Where is this used?" is a question only Docket can answer, and answering it requires a surface
 * inside Docket; leaving is the separate, deliberate second action at the top of the panel.
 */
import type { SearchResult } from '@docket/types';
import { OpenInNew, X } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import Link from 'next/link';
import type { JSX } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';

import { externalUrlOf, resourceEntityId } from './resource-catalog';

/** How a referencing record's kind is spelled in the panel's group headings. */
const SUBJECT_LABEL: Record<string, string> = {
  task: 'Tasks',
  project: 'Projects',
  program: 'Programs',
  initiative: 'Initiatives',
  team: 'Teams',
  comment: 'Comments',
  update: 'Updates',
};

/** Props for {@link ResourceDetailPanel}. */
export interface ResourceDetailPanelProps {
  /** The workspace the resource belongs to. */
  readonly orgId: string;
  /** The row being opened, already loaded by the list. */
  readonly resource: SearchResult;
  /** Close the panel (clears `resourceId` from the URL). */
  readonly onClose: () => void;
}

/**
 * Render the detail panel for one Library entry.
 *
 * @param props - The workspace, the opened row, and the close handler.
 * @returns the panel.
 */
export default function ResourceDetailPanel({
  orgId,
  resource,
  onClose,
}: ResourceDetailPanelProps): JSX.Element {
  const externalUrl = externalUrlOf(resource);

  const referencesQ = useApiQuery(
    apiQueryOptions(
      queryKeys.references(orgId, resource.kind, resourceEntityId(resource)),
      () =>
        api.v1.orgs[':orgId'].references[':targetKind'][':targetId'].$get({
          param: { orgId, targetKind: resource.kind, targetId: resourceEntityId(resource) },
        }),
      'Could not load what references this.',
    ),
  );

  return (
    <aside
      aria-label={`Details for ${resource.title}`}
      className="bg-surface-container-low flex min-w-0 flex-col gap-4 rounded-xl p-4"
    >
      <div className="flex items-start gap-2">
        <h2 className="text-title-small text-on-surface min-w-0 flex-1 font-medium break-words">
          {resource.title}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="min-h-10 min-w-10 shrink-0"
          aria-label="Close details"
          onClick={onClose}
        >
          <X aria-hidden className="size-4" />
        </Button>
      </div>

      {externalUrl ? (
        <a
          href={externalUrl}
          target="_blank"
          rel="noreferrer"
          className="text-on-surface-variant hover:text-on-surface flex min-h-10 items-center gap-2 text-sm"
        >
          <OpenInNew aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0 truncate">Open source</span>
        </a>
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="text-on-surface text-sm font-medium">Referenced by</h3>
        {/* Derived from prose, so there is nothing to curate and no empty-state call to action. */}
        <p className="text-on-surface-variant text-xs">
          Every record whose text points at this entry.
        </p>

        {referencesQ.isPending ? (
          <div className="flex flex-col gap-1" aria-label="Loading references">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-7 w-full" />
            ))}
          </div>
        ) : referencesQ.error ? (
          <p role="alert" className="text-destructive text-sm">
            {userErrorMessage(referencesQ.error, 'Could not load what references this.')}
          </p>
        ) : referencesQ.data.total > 0 ? (
          <div className="flex flex-col gap-3">
            {referencesQ.data.groups.map((group) => (
              <div key={group.subjectType} className="flex flex-col gap-0.5">
                <p className="text-on-surface-variant text-xs">
                  {SUBJECT_LABEL[group.subjectType] ?? group.subjectType} · {group.items.length}
                </p>
                {group.items.map((item) => (
                  <Link
                    key={`${item.subjectType}:${item.subjectId}`}
                    href={item.href}
                    className="text-on-surface hover:bg-surface-container-high flex min-h-10 items-center rounded-md px-2 text-sm"
                  >
                    <span className="min-w-0 truncate">{item.title}</span>
                  </Link>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-on-surface-variant text-sm">
            Nothing references this yet. It stays here because someone linked it once.
          </p>
        )}
      </div>
    </aside>
  );
}
