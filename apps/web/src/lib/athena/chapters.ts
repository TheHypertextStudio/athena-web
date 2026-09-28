'use client';

/** Typed reads and writes for user-marked spans of the personal Athena conversation. */
import { api } from '@/lib/api';
import { apiQueryOptions, STALE, unwrap } from '@/lib/query-core';
import { useApiMutation, useApiQuery } from '@/lib/query';

/** One durable chapter, including an unfinished span. */
export interface ConversationChapter {
  readonly id: string;
  readonly title: string;
  readonly startActivityId: string;
  readonly endActivityId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const CHAPTERS_KEY = ['me', 'athena', 'chat', 'chapters'] as const;

/** The current conversation's chapter index. */
export function chaptersDef(enabled = true) {
  return apiQueryOptions<{
    readonly sessionId: string;
    readonly items: readonly ConversationChapter[];
  }>(CHAPTERS_KEY, () => api.v1.me.athena.chat.chapters.$get(), 'Could not load chapters.', {
    enabled,
    staleTime: STALE.volatile,
  });
}

/** Read chapters and expose the three marker changes through the shared mutation layer. */
export function useConversationChapters(enabled: boolean) {
  const query = useApiQuery(chaptersDef(enabled));
  const start = useApiMutation({
    mutationFn: (input: { readonly startActivityId: string; readonly title: string }) =>
      unwrap(
        () => api.v1.me.athena.chat.chapters.$post({ json: input }),
        'Could not start chapter.',
      ),
    invalidateKeys: [CHAPTERS_KEY],
  });
  const end = useApiMutation({
    mutationFn: (input: { readonly chapterId: string; readonly endActivityId: string }) =>
      unwrap(
        () =>
          api.v1.me.athena.chat.chapters[':chapterId'].end.$put({
            param: { chapterId: input.chapterId },
            json: { endActivityId: input.endActivityId },
          }),
        'Could not end chapter.',
      ),
    invalidateKeys: [CHAPTERS_KEY],
  });
  const remove = useApiMutation({
    mutationFn: (chapterId: string) =>
      unwrap(
        () => api.v1.me.athena.chat.chapters[':chapterId'].$delete({ param: { chapterId } }),
        'Could not remove chapter.',
      ),
    invalidateKeys: [CHAPTERS_KEY],
  });
  return { query, start, end, remove };
}
