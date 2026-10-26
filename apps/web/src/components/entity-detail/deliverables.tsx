'use client';

import type { DeliverableOut } from '@docket/work/attachment-contract';
import { InlineBanner } from '@docket/ui/components';
import { FileText, Paperclip, X } from '@docket/ui/icons';
import {
  Button,
  Surface,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  focusRing,
} from '@docket/ui/primitives';
import { useRef, type JSX, type ReactNode } from 'react';
import { useDeliverableDraft, type DeliverableDraftState } from '@/lib/use-deliverable-draft';

/** Props shared by the comment and update attachment picker. */
export interface DeliverablePickerProps {
  readonly orgId: string;
  readonly files: readonly DeliverableOut[];
  readonly disabled: boolean;
  readonly onChange: (files: DeliverableOut[]) => void;
  readonly onBusy: (busy: boolean) => void;
  /** Primary composer action, aligned with the file chooser. */
  readonly primaryAction?: ReactNode;
  /** Optional composer controls such as update health. */
  readonly secondaryActions?: ReactNode;
}

/** Render a compact, named list of authenticated file downloads beneath a post. */
export function DeliverableList({
  files = [],
}: {
  readonly files?: readonly DeliverableOut[] | undefined;
}): JSX.Element | null {
  if (files.length === 0) return null;
  return (
    <ul aria-label="Attached files" className="mt-2 flex min-w-0 flex-col gap-2">
      {files.map((file) => (
        <Surface
          as="li"
          tone="card"
          shape="small"
          pad="tight"
          key={file.id}
          className="flex min-w-0 flex-col gap-2"
        >
          {file.previewUrl && file.mimeType.toLowerCase().startsWith('image/') ? (
            <img
              src={file.previewUrl}
              alt={file.title}
              loading="lazy"
              className="max-h-80 max-w-full self-start rounded-md object-contain"
            />
          ) : null}
          {file.previewUrl && file.mimeType.toLowerCase().startsWith('audio/') ? (
            <audio
              controls
              preload="metadata"
              src={file.previewUrl}
              aria-label={file.title}
              className="max-w-full"
            />
          ) : null}
          {file.previewUrl && file.mimeType.toLowerCase().startsWith('video/') ? (
            <video
              controls
              preload="metadata"
              src={file.previewUrl}
              aria-label={file.title}
              className="max-h-80 max-w-full self-start rounded-md"
            />
          ) : null}
          <div className="flex min-w-0 items-baseline gap-2">
            <FileText
              aria-hidden="true"
              className="text-on-surface-variant size-4 shrink-0 self-center"
            />
            <a
              href={file.downloadUrl}
              download={file.fileName}
              className={`text-primary text-body-medium coarse:min-h-10 coarse:min-w-10 coarse:py-2.5 min-w-0 break-words underline underline-offset-2 ${focusRing}`}
            >
              {file.title}
            </a>
            <span className="text-on-surface-variant text-body-small shrink-0">
              {fileSize(file.byteSize)}
            </span>
          </div>
        </Surface>
      ))}
    </ul>
  );
}

function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

/** Upload and remove private draft files, retaining successful uploads through post failures. */
export function DeliverablePicker({
  orgId,
  files,
  disabled,
  onChange,
  onBusy,
  primaryAction,
  secondaryActions,
}: DeliverablePickerProps): JSX.Element {
  const { busy, error, pending, select, retry, cancel, removePending, remove } =
    useDeliverableDraft({ orgId, files, disabled, onChange, onBusy });
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SelectedDeliverables files={files} disabled={disabled} onRemove={remove} />
      <PendingDeliverables
        pending={pending}
        disabled={disabled}
        retry={retry}
        cancel={cancel}
        removePending={removePending}
      />
      {error ? <InlineBanner tone="critical" density="compact" title={error} /> : null}
      <DeliverableActions
        busy={busy}
        disabled={disabled}
        fileCount={files.length}
        select={select}
        primaryAction={primaryAction}
        secondaryActions={secondaryActions}
      />
    </div>
  );
}

function DeliverableActions({
  busy,
  disabled,
  fileCount,
  select,
  primaryAction,
  secondaryActions,
}: {
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly fileCount: number;
  readonly select: (files: readonly File[]) => Promise<void>;
  readonly primaryAction?: ReactNode;
  readonly secondaryActions?: ReactNode;
}): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1">
        <input
          ref={input}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose files to attach"
          disabled={disabled || busy}
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []);
            event.target.value = '';
            void select(chosen);
          }}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Attach files"
              disabled={disabled || busy || fileCount >= 10}
              onClick={() => input.current?.click()}
            >
              <Paperclip aria-hidden="true" className="size-4" />
              <span className="hidden sm:inline">Attach files</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Up to 10 files · 100 MiB each
            <br />
            Unposted files kept privately for 7 days.
          </TooltipContent>
        </Tooltip>
        {secondaryActions}
        <span className="sr-only" role="status">
          {busy ? 'Uploading selected files…' : ''}
        </span>
      </div>
      {primaryAction}
    </div>
  );
}

function SelectedDeliverables({
  files,
  disabled,
  onRemove,
}: {
  readonly files: readonly DeliverableOut[];
  readonly disabled: boolean;
  readonly onRemove: (id: string) => Promise<void>;
}): JSX.Element | null {
  return files.length > 0 ? (
    <ul aria-label="Selected files" className="flex flex-col gap-1">
      {files.map((file) => (
        <Surface
          as="li"
          tone="card"
          shape="small"
          pad="tight"
          key={file.id}
          className="flex min-w-0 flex-col gap-2"
        >
          {file.previewUrl && file.mimeType.toLowerCase().startsWith('image/') ? (
            <img
              src={file.previewUrl}
              alt={file.title}
              className="max-h-28 max-w-full self-start rounded-md object-contain"
            />
          ) : null}
          {file.previewUrl && file.mimeType.toLowerCase().startsWith('audio/') ? (
            <audio
              controls
              preload="metadata"
              src={file.previewUrl}
              aria-label={file.title}
              className="max-w-full"
            />
          ) : null}
          {file.previewUrl && file.mimeType.toLowerCase().startsWith('video/') ? (
            <video
              controls
              preload="metadata"
              src={file.previewUrl}
              aria-label={file.title}
              className="max-h-28 max-w-full self-start rounded-md"
            />
          ) : null}
          <div className="text-body-medium flex min-w-0 items-center gap-2">
            <FileText aria-hidden="true" className="text-on-surface-variant size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={file.title}>
              {file.title}
            </span>
            <span className="text-on-surface-variant text-body-small shrink-0">
              {fileSize(file.byteSize)}
            </span>
            <Button
              type="button"
              variant="ghost"
              controlSize="sm"
              iconOnly
              aria-label={`Remove ${file.title}`}
              disabled={disabled}
              onClick={() => {
                void onRemove(file.id);
              }}
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          </div>
        </Surface>
      ))}
    </ul>
  ) : null;
}

function PendingDeliverables({
  pending,
  disabled,
  retry,
  cancel,
  removePending,
}: Pick<DeliverableDraftState, 'pending' | 'retry' | 'cancel' | 'removePending'> & {
  readonly disabled: boolean;
}): JSX.Element | null {
  return pending.length > 0 ? (
    <ul aria-label="Uploads in progress" className="flex flex-col gap-2">
      {pending.map((item) => (
        <Surface
          as="li"
          tone="card"
          shape="small"
          pad="tight"
          key={item.key}
          className="flex min-w-0 flex-col gap-2"
        >
          <div className="flex min-w-0 items-center gap-2">
            <FileText aria-hidden="true" className="text-on-surface-variant size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={item.file.name}>
              {item.file.name}
            </span>
            <span className="text-on-surface-variant text-body-small shrink-0">
              {fileSize(item.file.size)}
            </span>
          </div>
          <div className="flex items-center justify-end gap-1">
            {item.state === 'uploading' || item.state === 'queued' ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Cancel upload of ${item.file.name}`}
                onClick={() => {
                  cancel(item.key);
                }}
              >
                Cancel
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Retry upload of ${item.file.name}`}
                disabled={disabled}
                onClick={() => void retry(item.key)}
              >
                Retry
              </Button>
            )}
            {item.state !== 'uploading' ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove ${item.file.name} from this upload`}
                disabled={disabled}
                onClick={() => {
                  removePending(item.key);
                }}
              >
                Remove
              </Button>
            ) : null}
          </div>
          <PendingUploadStatus item={item} />
        </Surface>
      ))}
    </ul>
  ) : null;
}

function PendingUploadStatus({
  item,
}: {
  readonly item: DeliverableDraftState['pending'][number];
}): JSX.Element {
  return item.state === 'uploading' ? (
    <progress
      aria-label={`Uploading ${item.file.name}`}
      max={100}
      value={item.progress}
      className="w-full"
    />
  ) : item.state === 'queued' ? (
    <span className="text-on-surface-variant text-body-small" role="status">
      Waiting to upload…
    </span>
  ) : (
    <span className="text-on-surface-variant text-body-small" role="status">
      {item.state === 'cancelled'
        ? 'Upload cancelled. Retry or remove this file.'
        : 'Upload failed. Retry or remove this file.'}
    </span>
  );
}
