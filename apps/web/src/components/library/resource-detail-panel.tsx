'use client';

/** Docket context for one Library resource. */
import type { SearchResult } from '@docket/types';
import { Download, OpenInNew, X } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import { type JSX, useEffect, useRef } from 'react';

import { primaryResourceAction } from '@/components/library/resource-actions';
import { api } from '@/lib/api';
import { formatBytes } from '@/lib/format-bytes';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import { hrefForSearchResult } from '@/lib/search-route';

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
  /** Close the panel. */
  readonly onClose: () => void;
}

/** Render details, Docket context, and backlinks for one Library resource. */
export default function ResourceDetailPanel({
  orgId,
  resource,
  onClose,
}: ResourceDetailPanelProps): JSX.Element {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const attachment = resource.kind === 'attachment';
  const primaryAction = primaryResourceAction(resource);
  const hostHref = attachment ? hrefForSearchResult(resource) : null;
  const hostKind = resource.subject?.kind.replaceAll('_', ' ') ?? 'record';
  const fileName =
    typeof resource.facets['fileName'] === 'string' ? resource.facets['fileName'] : null;
  const mimeType =
    typeof resource.facets['mimeType'] === 'string' ? resource.facets['mimeType'] : null;
  const byteSize =
    typeof resource.facets['byteSize'] === 'number' ? resource.facets['byteSize'] : null;
  const fileMeta = [fileName, mimeType, formatBytes(byteSize)].filter((value): value is string =>
    Boolean(value),
  );

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
      'Could not load where this is used.',
      { enabled: !attachment },
    ),
  );

  return (
    <aside
      aria-label={`Details for ${resource.title}`}
      className="bg-surface-container-low flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto rounded-xl p-4"
    >
      <div className="flex items-start gap-2">
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

      {primaryAction ? (
        primaryAction.kind === 'internal' ? (
          <Link
            href={primaryAction.href}
            className="text-on-surface-variant hover:text-on-surface text-body-medium flex min-h-10 items-center gap-2"
          >
            <OpenInNew aria-hidden className="size-4 shrink-0" />
            <span>{primaryAction.label}</span>
          </Link>
        ) : (
          <a
            href={primaryAction.href}
            data-native-navigation=""
            {...(primaryAction.kind === 'external'
              ? { target: '_blank', rel: 'noreferrer' }
              : { download: fileName ?? true })}
            className="text-on-surface-variant hover:text-on-surface text-body-medium flex min-h-10 items-center gap-2"
          >
            {primaryAction.kind === 'download' ? (
              <Download aria-hidden className="size-4 shrink-0" />
            ) : (
              <OpenInNew aria-hidden className="size-4 shrink-0" />
            )}
            <span>{primaryAction.label}</span>
          </a>
        )
      ) : null}

      {attachment ? (
        <>
          {fileMeta.length > 0 ? (
            <p className="text-on-surface-variant text-body-small break-words">
              {fileMeta.join(' · ')}
            </p>
          ) : null}
          {hostHref && primaryAction?.href !== hostHref ? (
            <Link
              href={hostHref}
              className="text-on-surface-variant hover:text-on-surface text-body-medium flex min-h-10 items-center gap-2"
            >
              <OpenInNew aria-hidden className="size-4 shrink-0" />
              <span>Open {hostKind}</span>
            </Link>
          ) : null}
          <div className="flex flex-col gap-2">
            <h3 className="text-on-surface text-title-small">Work context</h3>
            {resource.usedIn.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {resource.usedIn.map((context) => (
                  <li key={`${context.kind}:${context.id}`}>
                    <span className="text-on-surface text-body-medium">{context.title}</span>
                    <span className="text-on-surface-variant text-label-small ml-2 capitalize">
                      {context.kind}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-on-surface-variant text-body-medium">Unreferenced</p>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <h3 className="text-on-surface text-title-small">Used by</h3>
          {referencesQ.isPending ? (
            <div className="flex flex-col gap-1" aria-hidden="true">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-7 w-full" />
              ))}
            </div>
          ) : referencesQ.error ? (
            <p role="alert" className="text-error text-body-medium">
              {userErrorMessage(referencesQ.error, 'Could not load where this is used.')}
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
            <p className="text-on-surface-variant text-body-medium">
              This resource is not used yet.
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
