'use client';

/** Review and individually undo task changes made during one Athena phone call. */
import type { PhoneCallSummaryOut, PhoneCallUndoOut } from '@docket/athena/voice';
import { X } from '@docket/ui/icons';
import {
  Button,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Skeleton,
  Text,
} from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { api } from '@/lib/api';
import { useAppLocation, navigateWithoutRouter } from '@/lib/app-location';
import { apiQueryOptions, unwrap, useApiMutation, useApiQuery } from '@/lib/query';
import { userErrorMessage } from '@/lib/problem';

/** Props for the call-summary deep-link sheet. */
export interface PhoneCallSummarySheetProps {
  readonly voiceSessionId: string | null;
}

/** Show one call over the canonical Athena timeline without creating another call-log surface. */
export function PhoneCallSummarySheet({ voiceSessionId }: PhoneCallSummarySheetProps): JSX.Element {
  const location = useAppLocation();
  const [notice, setNotice] = useState<string | null>(null);
  const summaryKey = ['athena', 'phone-call', voiceSessionId ?? 'closed'] as const;
  const summary = useApiQuery(
    apiQueryOptions<PhoneCallSummaryOut>(
      summaryKey,
      () =>
        api.v1.me.athena.voice[':id'].summary.$get({
          param: { id: voiceSessionId ?? 'closed' },
        }),
      'Could not load that phone call.',
      { enabled: voiceSessionId !== null },
    ),
  );
  const undo = useApiMutation<PhoneCallUndoOut, string>({
    mutationFn: (changeSetId) => {
      if (!voiceSessionId) throw new Error('phone call is closed');
      return unwrap(
        () =>
          api.v1.me.athena.voice[':id'].changes[':changeSetId'].undo.$post({
            param: { id: voiceSessionId, changeSetId },
          }),
        'That change can no longer be undone.',
      );
    },
    invalidateKeys: [summaryKey],
    onSuccess: () => {
      setNotice(null);
    },
    onError: (error) => {
      setNotice(userErrorMessage(error, 'That change can no longer be undone.'));
    },
  });

  const close = (): void => {
    const search = new URLSearchParams(location.searchParams.toString());
    search.delete('call');
    const query = search.toString();
    navigateWithoutRouter(query ? `${location.pathname}?${query}` : location.pathname);
  };

  const changes = summary.data?.changes ?? [];
  return (
    <Sheet
      open={voiceSessionId !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <SheetContent side="right" className="w-full max-w-md gap-4 p-4" data-phone-call-summary>
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <SheetTitle>Athena phone call</SheetTitle>
            <SheetDescription>
              {changes.length > 1
                ? 'Review each task change from this call.'
                : 'Review the task change from this call.'}
            </SheetDescription>
          </div>
          <SheetClose asChild>
            <Button variant="ghost" iconOnly aria-label="Close call summary">
              <X aria-hidden="true" />
            </Button>
          </SheetClose>
        </div>

        {summary.isPending ? (
          <div className="flex flex-col gap-2" aria-label="Loading call summary">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : summary.isError ? (
          <p role="alert" className="text-error">
            Could not load that phone call.
          </p>
        ) : changes.length === 0 ? (
          <Text token="body-medium" tone="muted">
            This call did not change any tasks.
          </Text>
        ) : (
          <ul className="flex min-w-0 flex-col gap-2">
            {changes.map((change) => (
              <li
                key={change.changeSetId}
                className="bg-surface-container flex min-w-0 items-center gap-3 rounded-lg p-3"
              >
                <Text token="body-medium" className="min-w-0 flex-1">
                  {change.summary}
                </Text>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 whitespace-nowrap"
                  disabled={!change.undoAvailable || undo.isPending}
                  onClick={() => {
                    undo.mutate(change.changeSetId);
                  }}
                >
                  {change.undoneAt ? 'Undone' : 'Undo'}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {notice ? (
          <p role="alert" className="text-error">
            {notice}
          </p>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
