/**
 * The attachments section of the task detail page — the general attachment model, made visible.
 *
 * @remarks
 * Renders each attachment as a card: an `email` card shows the source thread's sender/subject/
 * snippet with an open-in-Gmail link (created by accepting an Athena suggestion; read-only here),
 * a `calendar_event` card shows Google Calendar event context, a `url` card shows a pasted link,
 * and a `file` card shows an uploaded file with its size and a download link. A small toolbar
 * uploads a file or attaches a link. External context rides along with the task — it is never the
 * task itself. See `docs/engineering/specs/email-to-task.md` §9.
 */
'use client';

import type { AttachmentOut } from '@docket/types';
import { cn } from '@docket/ui/lib/utils';
import { Button, buttonVariants, Card, CardContent, Input } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { formatBytes } from '@/lib/format-bytes';
import { useTaskAttachments } from '@/lib/use-attachments';

/** Read a string field off an attachment's untyped metadata bag. */
function metaString(attachment: AttachmentOut, field: string): string | null {
  const meta = attachment.metadata;
  if (!meta || typeof meta !== 'object') return null;
  const value = meta[field];
  return typeof value === 'string' ? value : null;
}

/** Props for {@link AttachmentCard}. */
interface AttachmentCardProps {
  /** The attachment to render. */
  attachment: AttachmentOut;
  /** Same-origin download URL, present for `file` attachments. */
  downloadHref: string | null;
  /** Remove the attachment. */
  onRemove: () => void;
  /** Whether the viewer may remove it. */
  canEdit: boolean;
}

/** One attachment card — email/calendar context, a plain URL link, or an uploaded file. */
function AttachmentCard({
  attachment,
  downloadHref,
  onRemove,
  canEdit,
}: AttachmentCardProps): JSX.Element {
  const isEmail = attachment.kind === 'email';
  const isCalendarEvent = attachment.kind === 'calendar_event';
  const isFile = attachment.kind === 'file';
  const sender = metaString(attachment, 'sender');
  const snippet = metaString(attachment, 'snippet');
  const calendarTitle = metaString(attachment, 'calendarTitle');
  const startsAt = metaString(attachment, 'startsAt');
  const fileMeta = [attachment.fileName, formatBytes(attachment.byteSize)]
    .filter(Boolean)
    .join(' · ');
  const kindLabel = isEmail ? 'Email' : isCalendarEvent ? 'Calendar' : isFile ? 'File' : 'Link';
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs tracking-wide uppercase">
              {kindLabel}
            </span>
            <span className="truncate text-sm font-medium">{attachment.title}</span>
          </div>
          {isEmail && sender ? (
            <span className="text-muted-foreground truncate text-xs">From {sender}</span>
          ) : null}
          {isEmail && snippet ? (
            <span className="text-muted-foreground line-clamp-2 text-xs">{snippet}</span>
          ) : null}
          {isCalendarEvent && calendarTitle ? (
            <span className="text-muted-foreground truncate text-xs">{calendarTitle}</span>
          ) : null}
          {isCalendarEvent && startsAt ? (
            <span className="text-muted-foreground truncate text-xs">
              {new Date(startsAt).toLocaleString()}
            </span>
          ) : null}
          {isFile && fileMeta ? (
            <span className="text-muted-foreground truncate text-xs">{fileMeta}</span>
          ) : null}
          {isFile ? (
            downloadHref ? (
              <a
                href={downloadHref}
                download
                className="text-primary truncate text-xs hover:underline"
              >
                Download
              </a>
            ) : null
          ) : attachment.url ? (
            <a
              href={attachment.url}
              target="_blank"
              rel="noreferrer"
              className="text-primary truncate text-xs hover:underline"
            >
              {isEmail
                ? 'Open in Gmail'
                : isCalendarEvent
                  ? 'Open in Google Calendar'
                  : attachment.url}
            </a>
          ) : null}
        </div>
        {canEdit ? (
          <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Remove attachment">
            Remove
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Props for {@link TaskAttachments}. */
interface TaskAttachmentsProps {
  /** The active organization id. */
  orgId: string;
  /** The task being viewed. */
  taskId: string;
  /** Whether the viewer may add/remove attachments (`contribute`). */
  canEdit: boolean;
}

/** The attachments section for a task. */
export default function TaskAttachments({
  orgId,
  taskId,
  canEdit,
}: TaskAttachmentsProps): JSX.Element {
  const { attachments, addUrl, addFile, remove, downloadUrl, isUploading, actionError } =
    useTaskAttachments(orgId, taskId);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');

  const submit = async (): Promise<void> => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    await addUrl({ url: trimmedUrl, title: title.trim() || trimmedUrl });
    setUrl('');
    setTitle('');
  };

  return (
    <section aria-labelledby="attachments-heading" className="flex flex-col gap-2">
      <h2 id="attachments-heading" className="text-sm font-semibold">
        Attachments
      </h2>

      {attachments.length === 0 ? (
        <p className="text-muted-foreground text-sm">No attachments yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {attachments.map((a) => (
            <AttachmentCard
              key={a.id}
              attachment={a}
              downloadHref={a.kind === 'file' ? downloadUrl(a.id) : null}
              canEdit={canEdit}
              onRemove={() => void remove(a.id)}
            />
          ))}
        </div>
      )}

      {canEdit ? (
        <div className="flex flex-col gap-2">
          <label
            className={cn(
              buttonVariants({ variant: 'secondary', size: 'sm' }),
              'w-fit cursor-pointer',
            )}
          >
            {isUploading ? 'Uploading…' : 'Upload file'}
            <input
              type="file"
              className="sr-only"
              disabled={isUploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void addFile({ file });
              }}
            />
          </label>

          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Input
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
              }}
              placeholder="Paste a link to attach…"
              type="url"
              aria-label="Attachment URL"
            />
            <Input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
              placeholder="Label (optional)"
              aria-label="Attachment label"
              className="sm:max-w-[12rem]"
            />
            <Button type="submit" size="sm" disabled={url.trim().length === 0}>
              Attach
            </Button>
          </form>
        </div>
      ) : null}

      {actionError ? <p className="text-destructive text-xs">{actionError}</p> : null}
    </section>
  );
}
