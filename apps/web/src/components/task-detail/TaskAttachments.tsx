/**
 * The attachments section of the task detail page — the general attachment model, made visible.
 *
 * @remarks
 * Renders each attachment as a card: an `email` card shows the source thread's sender/subject/
 * snippet with an open-in-Gmail link (created by accepting an Athena suggestion; read-only
 * here), a `calendar_event` card shows Google Calendar event context, and a `url` card shows a
 * pasted link. A small form attaches a new link. External context rides along with the task — it
 * is never the task itself.
 * See `docs/engineering/specs/email-to-task.md` §9.
 */
'use client';

import type { AttachmentOut } from '@docket/types';
import { Button, Card, CardContent, Input } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { useTaskAttachments } from '@/lib/use-attachments';

/** Read a string field off an attachment's untyped metadata bag. */
function metaString(attachment: AttachmentOut, field: string): string | null {
  const meta = attachment.metadata;
  if (!meta || typeof meta !== 'object') return null;
  const value = meta[field];
  return typeof value === 'string' ? value : null;
}

/** One attachment card — email/calendar context or a plain URL link. */
function AttachmentCard({
  attachment,
  onRemove,
  canEdit,
}: {
  attachment: AttachmentOut;
  onRemove: () => void;
  canEdit: boolean;
}): JSX.Element {
  const isEmail = attachment.kind === 'email';
  const isCalendarEvent = attachment.kind === 'calendar_event';
  const sender = metaString(attachment, 'sender');
  const snippet = metaString(attachment, 'snippet');
  const calendarTitle = metaString(attachment, 'calendarTitle');
  const startsAt = metaString(attachment, 'startsAt');
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs tracking-wide uppercase">
              {isEmail ? 'Email' : isCalendarEvent ? 'Calendar' : 'Link'}
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
          {attachment.url ? (
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

/**
 * The attachments section for a task.
 *
 * @param orgId - The active organization id.
 * @param taskId - The task being viewed.
 * @param canEdit - Whether the viewer may add/remove attachments (`contribute`).
 */
export default function TaskAttachments({
  orgId,
  taskId,
  canEdit,
}: {
  orgId: string;
  taskId: string;
  canEdit: boolean;
}): JSX.Element {
  const { attachments, addUrl, remove, actionError } = useTaskAttachments(orgId, taskId);
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
              canEdit={canEdit}
              onRemove={() => void remove(a.id)}
            />
          ))}
        </div>
      )}

      {canEdit ? (
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
      ) : null}

      {actionError ? <p className="text-destructive text-xs">{actionError}</p> : null}
    </section>
  );
}
