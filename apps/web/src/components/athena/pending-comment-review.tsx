'use client';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  focusRing,
} from '@docket/ui/primitives';
import { ChevronDown } from '@docket/ui/icons';
import type { JSX } from 'react';

import { commentPreviewContent, type CommentPreviewContent } from './comment-preview';
import type { PersonalAthenaSessionDetail } from '@/lib/athena/presentation';

/** The native comment currently awaiting the owner's approval. */
export interface PendingCommentReview {
  readonly activityId: string;
  readonly content: CommentPreviewContent;
}

/** Resolve the latest proposed tool only, preserving native tool identity and saved content. */
export function pendingCommentReview(
  detail: PersonalAthenaSessionDetail | undefined,
): PendingCommentReview | null {
  if (detail?.decision?.kind !== 'approval') return null;
  const activity = detail.activities.filter((entry) => entry.type === 'tool').at(-1);
  if (activity?.type !== 'tool' || activity.approvalStatus !== 'proposed') return null;
  const content = commentPreviewContent(activity.technical);
  return content ? { activityId: activity.id, content } : null;
}

/** Keep the original request accessible without making it the review's headline. */
export function ReviewRequest({ objective }: { readonly objective: string }): JSX.Element {
  return (
    <Collapsible>
      <CollapsibleTrigger
        className={`text-on-surface-variant text-label-medium hover:text-on-surface group flex min-h-10 items-center gap-1 ${focusRing}`}
      >
        Original request
        <ChevronDown
          aria-hidden="true"
          className="size-4 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="text-on-surface-variant text-body-small pb-2 break-words whitespace-pre-wrap">
          {objective}
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
