'use client';

import { Button, Text } from '@docket/ui/primitives';
import type { JSX } from 'react';

import DocketLink from '@/components/docket-link';
import { StaticMarkdown } from '@/components/editor/static-markdown';
import type { AthenaActivityPresentation } from '@/lib/athena/presentation';

/** A native comment's saved content and optional task destination. */
export interface CommentPreviewContent {
  readonly body: string;
  readonly taskHref?: string;
  readonly truncated: boolean;
  readonly redacted: boolean;
}

/** Resolve only the documented native task-comment destination. */
function commentTaskHref(fields: Readonly<Record<string, unknown>>): string | undefined {
  const orgId = fields['orgId'];
  const subjectId = fields['subjectId'];
  if (fields['subjectType'] !== 'task') return undefined;
  if (typeof orgId !== 'string' || !orgId.trim()) return undefined;
  if (typeof subjectId !== 'string' || !subjectId.trim()) return undefined;
  return `/orgs/${encodeURIComponent(orgId)}/tasks/${encodeURIComponent(subjectId)}`;
}

/** Read a native comment without interpreting other tools or malformed saved arguments. */
export function commentPreviewContent(
  technical: AthenaActivityPresentation['technical'],
): CommentPreviewContent | null {
  if (technical?.toolName !== 'comment' || technical.connection !== 'docket') return null;
  const input = technical.commentPreview;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const fields = input as Readonly<Record<string, unknown>>;
  if (typeof fields['body'] !== 'string') return null;
  const taskHref = commentTaskHref(fields);
  return {
    body: fields['body'],
    truncated: fields['truncated'] === true,
    redacted: fields['redacted'] === true,
    ...(taskHref ? { taskHref } : {}),
  };
}

/** Show the comment itself at the step's full width without changing its approval state. */
export function CommentPreview({
  content,
}: {
  readonly content: CommentPreviewContent;
}): JSX.Element {
  return (
    <section aria-label="Comment preview" className="flex min-w-0 flex-col gap-2 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text as="p" token="label-medium" tone="muted">
          Comment preview
        </Text>
        {content.taskHref ? (
          <Button asChild variant="link" controlSize="md" className="-my-2">
            <DocketLink href={content.taskHref}>View task</DocketLink>
          </Button>
        ) : null}
      </div>
      {content.redacted ? (
        <Text as="p" token="body-medium" tone="muted">
          Comment content is hidden because it contains credential-like text.
        </Text>
      ) : (
        <StaticMarkdown value={content.body} className="min-w-0 break-words" />
      )}
      {content.truncated ? (
        <Text as="p" token="body-small" tone="muted">
          This preview shows only the beginning of the comment. Approval posts the complete comment.
        </Text>
      ) : null}
    </section>
  );
}
