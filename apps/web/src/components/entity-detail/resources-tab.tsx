'use client';

/** Entity resources tab: linked documents and URLs as first-class operating context. */
import { canonicalizeResourceUrl, type AttachmentOut, type EntityMention } from '@docket/types';
import { Calendar, FileText, Link as LinkIcon, Mail, Plus, Trash2 } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';

import MentionedResources from './mentioned-resources';

import {
  MailAttachmentsPanel,
  type MailAttachmentSubject,
} from '@/components/athena/mail-attachments-panel';
import { formatBytes } from '@/lib/format-bytes';

/** Props for {@link ResourcesTab}. */
export interface ResourcesTabProps {
  resources: readonly AttachmentOut[];
  /** True while the resource collection is loading. */
  loading?: boolean;
  canEdit: boolean;
  pending: boolean;
  error: string | null;
  onAdd: (resource: { title: string; url: string }) => void;
  onRemove: (resourceId: string) => void;
  /** Upload a file into the same attachment collection. */
  onUpload?: (file: File) => void;
  /** Whether a file upload is in flight. */
  uploading?: boolean;
  /** Return a same-origin download URL for a file attachment. */
  downloadHref?: (resourceId: string) => string;
  /**
   * The entity this tab belongs to, so mail Athena received and someone attached here can render.
   *
   * @remarks
   * Optional so a caller that has not been threaded through yet keeps working unchanged; the
   * section renders nothing when nothing is attached, so passing it costs an idle query and no
   * layout.
   */
  subject?: {
    readonly type: MailAttachmentSubject;
    readonly id: string;
    readonly organizationId: string;
  };
  /** References the entity's own prose points at, derived rather than curated. */
  readonly mentionedExternal?: readonly EntityMention[];
  /** Other Docket records this entity's prose points at. */
  readonly mentionedEntities?: readonly EntityMention[];
  /** True while the derived read is in flight. */
  readonly mentionsPending?: boolean;
  /** Whether the entity has prose at all; false suppresses the derived loading state. */
  readonly hasProse?: boolean;
}

/**
 * The canonical keys already covered by a hand-added resource.
 *
 * @remarks
 * A document that was both attached and mentioned belongs in the curated list only. Showing it
 * twice reads as a bug, and the curated row is the one carrying a remove control.
 */
function attachedKeys(resources: readonly AttachmentOut[]): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const resource of resources) {
    if (resource.kind !== 'url' || resource.url === null) continue;
    const canonical = canonicalizeResourceUrl(resource.url);
    if (canonical !== undefined) keys.add(`url:${canonical.canonicalUrl}`);
  }
  return keys;
}

/** Keep one direct row for one canonical URL while retaining files and provider-backed context. */
function displayedResources(resources: readonly AttachmentOut[]): readonly AttachmentOut[] {
  const seenUrls = new Set<string>();
  return resources.filter((resource) => {
    if (resource.kind !== 'url' || resource.url === null) return true;
    const canonical = canonicalizeResourceUrl(resource.url);
    if (canonical === undefined) return true;
    const key = canonical.canonicalUrl;
    if (seenUrls.has(key)) return false;
    seenUrls.add(key);
    return true;
  });
}

/** Read one optional string from an attachment's typed JSON metadata. */
function metadataString(resource: AttachmentOut, field: string): string | null {
  const value = resource.metadata?.[field];
  return typeof value === 'string' ? value : null;
}

/** Render copy and an icon for one attachment kind without treating provider context as a URL. */
function attachmentPresentation(resource: AttachmentOut): {
  readonly label: string;
  readonly detail: string | null;
  readonly Icon: typeof LinkIcon;
} {
  switch (resource.kind) {
    case 'email':
      return {
        label: 'Email',
        detail: metadataString(resource, 'sender') ?? metadataString(resource, 'fromName'),
        Icon: Mail,
      };
    case 'athena_email':
      return {
        label: 'Email',
        detail: metadataString(resource, 'fromName') ?? metadataString(resource, 'fromAddress'),
        Icon: Mail,
      };
    case 'calendar_event':
      return {
        label: 'Calendar',
        detail: metadataString(resource, 'startsAt') ?? metadataString(resource, 'calendarTitle'),
        Icon: Calendar,
      };
    case 'file':
      return {
        label: 'File',
        detail:
          [resource.fileName, formatBytes(resource.byteSize)].filter(Boolean).join(' · ') || null,
        Icon: FileText,
      };
    case 'url':
      return { label: 'Link', detail: null, Icon: LinkIcon };
  }
}

/** Render URL resources in a dedicated, dense tab rather than burying them in metadata. */
export function ResourcesTab({
  resources,
  loading = false,
  canEdit,
  pending,
  error,
  onAdd,
  onRemove,
  onUpload,
  uploading = false,
  downloadHref,
  subject,
  mentionedExternal = [],
  mentionedEntities = [],
  mentionsPending = false,
  hasProse = false,
}: ResourcesTabProps): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');

  const covered = useMemo(() => attachedKeys(resources), [resources]);
  const directResources = useMemo(() => displayedResources(resources), [resources]);
  const derivedExternal = useMemo(
    () =>
      mentionedExternal.filter((mention) => {
        const canonical =
          mention.resource === null
            ? undefined
            : canonicalizeResourceUrl(mention.resource.canonicalUrl);
        return canonical === undefined || !covered.has(`url:${canonical.canonicalUrl}`);
      }),
    [mentionedExternal, covered],
  );
  const hasDerived = derivedExternal.length > 0 || mentionedEntities.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-on-surface text-title-small">Resources</h2>
          <p className="text-on-surface-variant text-body-small mt-1">
            Plans, briefs, folders, and external references.
          </p>
        </div>
        {canEdit ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-10 gap-1.5"
            onClick={() => {
              setAdding((value) => !value);
            }}
          >
            <Plus aria-hidden className="size-4" /> Add resource
          </Button>
        ) : null}
      </div>

      {adding ? (
        <form
          className="bg-surface-container-low grid gap-3 rounded-xl p-4 @2xl:grid-cols-[minmax(10rem,0.75fr)_minmax(16rem,1.25fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            if (!title.trim() || !url.trim()) return;
            onAdd({ title: title.trim(), url: url.trim() });
            setTitle('');
            setUrl('');
            setAdding(false);
          }}
        >
          <input
            className="border-outline bg-surface text-body-small h-10 rounded-md border px-3"
            aria-label="Resource title"
            placeholder="Resource title"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
          <input
            className="border-outline bg-surface text-body-small h-10 rounded-md border px-3"
            aria-label="Resource URL"
            placeholder="https://"
            type="url"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
            }}
          />
          <Button
            type="submit"
            size="sm"
            className="min-h-10"
            disabled={pending || !title.trim() || !url.trim()}
          >
            Add
          </Button>
        </form>
      ) : null}

      {loading ? (
        <p className="text-on-surface-variant bg-surface-container-low text-body-small rounded-xl px-4 py-8 text-center">
          Loading resources…
        </p>
      ) : directResources.length > 0 ? (
        <ul className="bg-surface-container-low rounded-xl p-2">
          {directResources.map((resource) => {
            const presentation = attachmentPresentation(resource);
            const href = resource.kind === 'file' ? downloadHref?.(resource.id) : resource.url;
            const title =
              resource.kind === 'file' && href !== undefined
                ? `Download ${resource.title}`
                : resource.title;
            return (
              <li
                key={resource.id}
                className="hover:bg-surface-container-high flex min-h-14 items-center gap-3 rounded-lg px-3 py-2 transition-colors"
              >
                <span className="bg-primary-container text-on-primary-container flex size-8 shrink-0 items-center justify-center rounded-full">
                  <presentation.Icon aria-hidden className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  {href ? (
                    <a
                      href={href}
                      {...(resource.kind === 'file'
                        ? { download: true, 'aria-label': title }
                        : { target: '_blank', rel: 'noreferrer' })}
                      className="text-on-surface text-body-small block truncate hover:underline"
                    >
                      {resource.title}
                    </a>
                  ) : (
                    <span className="text-on-surface text-body-small block truncate">
                      {resource.title}
                    </span>
                  )}
                  <span className="text-on-surface-variant text-label-small block truncate">
                    {presentation.label}
                    {presentation.detail ? ` · ${presentation.detail}` : ''}
                  </span>
                </span>
                {canEdit ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="min-h-10 min-w-10"
                    aria-label={`Remove ${resource.title}`}
                    disabled={pending || uploading}
                    onClick={() => {
                      onRemove(resource.id);
                    }}
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : hasDerived ? null : (
        <p className="text-on-surface-variant bg-surface-container-low text-body-small rounded-xl px-4 py-8 text-center">
          No linked resources yet.
        </p>
      )}
      {canEdit && onUpload ? (
        <label className="text-primary text-body-small hover:bg-surface-container-high flex min-h-10 w-fit cursor-pointer items-center rounded-md px-3">
          {uploading ? 'Uploading file…' : 'Upload file'}
          <input
            type="file"
            className="sr-only"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) onUpload(file);
            }}
          />
        </label>
      ) : null}
      {subject ? (
        <MailAttachmentsPanel
          subjectType={subject.type}
          subjectId={subject.id}
          organizationId={subject.organizationId}
        />
      ) : null}

      <MentionedResources
        heading="Mentioned in this record"
        mentions={derivedExternal}
        pending={mentionsPending}
        hasProse={hasProse}
      />
      <MentionedResources
        heading="Related records"
        mentions={mentionedEntities}
        pending={mentionsPending}
        hasProse={hasProse}
      />
      {error ? (
        <p role="alert" className="text-error text-body-small">
          {error}
        </p>
      ) : null}
    </div>
  );
}
