'use client';

import type { AthenaMailAttachmentOut } from '@docket/athena/athena-mail-contract';
import { Surface, Text } from '@docket/ui/primitives';
import type { JSX } from 'react';
import { mailFileDownloadHref } from './mail-query-defs';

/** Received files expose only validated downloads and application-owned processing explanations. */
export function MailFiles({
  messageId,
  files,
}: {
  readonly messageId: string;
  readonly files: readonly AthenaMailAttachmentOut[];
}): JSX.Element | null {
  if (!files.length) return null;
  return (
    <Surface tone="card" shape="medium" pad="roomy" className="flex flex-col gap-3">
      <Text as="h2" token="title-small">
        Files
      </Text>
      <Text as="p" token="body-small" tone="muted">
        Athena reads UTF-8 text, Markdown and CSV files (.txt, .md, .csv), up to 64 KiB each and
        five files per email.
      </Text>
      <ul className="flex flex-col gap-3">
        {files.map((file) => (
          <li key={file.id} className="flex min-w-0 flex-col gap-1">
            <Text token="body-medium" className="break-all">
              {file.filename}
            </Text>
            {file.status === 'ready' ? (
              <a
                className="text-primary text-body-small underline"
                download={file.filename}
                href={mailFileDownloadHref(messageId, file.id)}
                aria-label={`Download ${file.filename}`}
              >
                Download{file.size === undefined ? '' : ` · ${file.size.toLocaleString()} bytes`}
              </a>
            ) : (
              <Text as="p" token="body-small" tone="muted">
                {fileExplanation(file)}
              </Text>
            )}
          </li>
        ))}
      </ul>
    </Surface>
  );
}

function fileExplanation(file: AthenaMailAttachmentOut): string {
  if (file.status === 'unavailable') return 'This file is not available yet. Athena will retry.';
  if (file.status !== 'rejected') return 'Waiting for file processing.';
  if (file.errorCode === 'attachment_unsupported') return 'This file type is not supported.';
  if (file.errorCode === 'attachment_count_limit')
    return 'Only the first five files can be processed. Send this file in another email.';
  return 'Athena could not safely read this file. Send a supported text file within the size limit.';
}
