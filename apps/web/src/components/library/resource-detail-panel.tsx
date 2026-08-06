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
import { type JSX, useEffect, useRef } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';

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
  const externalUrl = resource.externalUrl;
  const headingRef = useRef<HTMLHeadingElement>(null);

  /*
   * Take focus when the panel appears.
   *
   * Below the split breakpoint the list is `display: none` while the grid inside it still holds
   * DOM focus, and hiding a focused element drops focus to `<body>` — a keyboard or screen-reader
   * user activates a row and lands nowhere, with nothing announcing that a panel opened. Moving
   * focus to the heading both restores a position and reads the entry's name.
   *
   * Keyed on the entry, so paging from one row to the next re-announces rather than sitting
   * silently on the previous heading.
   */
  useEffect(() => {
    headingRef.current?.focus();
  }, [resource.entityId]);

  const referencesQ = useApiQuery(
    apiQueryOptions(
      queryKeys.references(orgId, resource.kind, resource.entityId),
      () =>
        api.v1.orgs[':orgId'].references[':targetKind'][':targetId'].$get({
          param: { orgId, targetKind: resource.kind, targetId: resource.entityId },
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
        {/* `tabIndex={-1}` makes the heading programmatically focusable without adding it to the
            tab order — the focus target above, not a stop a keyboard user has to pass through. */}
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-title-small text-on-surface min-w-0 flex-1 break-words outline-none"
        >
          {resource.title}
        </h2>
        <Button
          type="button"
          variant="ghost"
          iconOnly
          controlSize="xl"
          className="shrink-0"
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
          className="text-on-surface-variant hover:text-on-surface text-body-medium flex min-h-10 items-center gap-2"
        >
          <OpenInNew aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0 truncate">Open source</span>
        </a>
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="text-on-surface text-title-small">Referenced by</h3>
        {referencesQ.isPending ? (
          <div className="flex flex-col gap-1" aria-hidden="true">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-7 w-full" />
            ))}
          </div>
        ) : referencesQ.error ? (
          <p role="alert" className="text-error text-body-medium">
            {userErrorMessage(referencesQ.error, 'Could not load what references this.')}
          </p>
        ) : referencesQ.data.total > 0 ? (
          <div className="flex flex-col gap-3">
            {referencesQ.data.groups.map((group) => (
              <div key={group.subjectType} className="flex flex-col gap-0.5">
                <p className="text-on-surface-variant text-label-small">
                  {SUBJECT_LABEL[group.subjectType] ?? group.subjectType} · {group.items.length}
                </p>
                {group.items.map((item) => (
                  <Link
                    key={`${item.subjectType}:${item.subjectId}`}
                    href={item.href}
                    className="text-on-surface hover:bg-surface-container-high text-body-medium flex min-h-10 items-center rounded-md px-2"
                  >
                    <span className="min-w-0 truncate">{item.title}</span>
                  </Link>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-on-surface-variant text-body-medium">Nothing references this yet.</p>
        )}
      </div>
    </aside>
  );
}
