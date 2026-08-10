'use client';

/**
 * A minimal interruption handoff for Focus.
 *
 * @remarks
 * This is intentionally not a conversation surface. It accepts one sentence, creates personal
 * Athena work with no active-workspace or task context, and renders only an application-owned
 * lifecycle receipt. The latest work id is stored so the rail and a Focus pop-out follow the same
 * handoff without copying replies, activities, tool output, or provider text into Focus.
 */
import { readStoredString, writeStoredValue } from '@docket/ui/lib/browser-storage';
import { ArrowUp, Sparkles } from '@docket/ui/icons';
import { Button, Text } from '@docket/ui/primitives';
import Link from 'next/link';
import { type JSX, type SyntheticEvent, useEffect, useState } from 'react';

import { athenaHref, personalAthenaTransport } from '@/lib/athena/query-defs';
import type { PersonalAthenaSessionDetail } from '@/lib/athena/presentation';
import {
  ApiRequestError,
  apiQueryOptions,
  queryKeys,
  STALE,
  unwrap,
  useApiMutation,
  useApiQuery,
} from '@/lib/query';
import type { RpcResponse } from '@/lib/query-core';

/** Cross-window storage key for the newest interruption handed to Athena. */
export const FOCUS_ATHENA_HANDOFF_KEY = 'docket.focus.athena-handoff';

/** The only transport operations Focus may perform. */
export interface FocusAthenaTransport {
  readonly create: (input: {
    readonly prompt: string;
  }) => Promise<RpcResponse<PersonalAthenaSessionDetail>>;
  readonly detail: (sessionId: string) => Promise<RpcResponse<PersonalAthenaSessionDetail>>;
}

/** Props for {@link FocusAthenaHandoff}. */
export interface FocusAthenaHandoffProps {
  readonly transport?: FocusAthenaTransport;
  /** Use a full-size submit target in immersive mode. */
  readonly comfortable?: boolean;
}

/** Whether a personal Athena lifecycle no longer needs polling. */
function isTerminal(status: PersonalAthenaSessionDetail['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled';
}

/** Map lifecycle only—not agent output—to Focus's one-line receipt. */
function receiptFor(status: PersonalAthenaSessionDetail['status']): string {
  if (status === 'completed') return 'Handled in Personal.';
  if (status === 'awaiting_input' || status === 'awaiting_approval') return 'Needs one detail.';
  if (status === 'failed') return 'Athena could not finish it.';
  if (status === 'canceled') return 'Athena stopped handling it.';
  return 'Athena is handling it.';
}

/** Hand one interruption to Personal Athena and show its latest action receipt. */
export default function FocusAthenaHandoff({
  transport = personalAthenaTransport,
  comfortable = false,
}: FocusAthenaHandoffProps): JSX.Element {
  const [prompt, setPrompt] = useState('');
  const [latestId, setLatestId] = useState('');
  const [created, setCreated] = useState<PersonalAthenaSessionDetail | null>(null);

  useEffect(() => {
    setLatestId(readStoredString(FOCUS_ATHENA_HANDOFF_KEY) ?? '');
    const receiveLatest = (event: StorageEvent): void => {
      if (event.key !== FOCUS_ATHENA_HANDOFF_KEY) return;
      setCreated(null);
      setLatestId(event.newValue ?? '');
    };
    window.addEventListener('storage', receiveLatest);
    return () => {
      window.removeEventListener('storage', receiveLatest);
    };
  }, []);

  const live = useApiQuery(
    apiQueryOptions(
      queryKeys.athenaSession(latestId),
      () => transport.detail(latestId),
      'Could not refresh this Athena handoff.',
      {
        enabled: latestId.length > 0 && !(created && isTerminal(created.status)),
        staleTime: STALE.volatile,
        refetchInterval: (query) => {
          const latest = query.state.data;
          return latest && isTerminal(latest.status) ? false : 4_000;
        },
      },
    ),
  );
  const detail = live.data ?? created;

  const create = useApiMutation<PersonalAthenaSessionDetail, string>({
    mutationFn: (nextPrompt) =>
      unwrap(
        () => transport.create({ prompt: nextPrompt }),
        'Athena could not start handling this.',
      ),
    invalidateKeys: [queryKeys.athena()],
    onSuccess: (next) => {
      setPrompt('');
      setCreated(next);
      setLatestId(next.id);
      writeStoredValue(FOCUS_ATHENA_HANDOFF_KEY, next.id);
    },
  });

  const submit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const next = prompt.trim();
    if (next.length === 0 || create.isPending) return;
    // Deliberately only a prompt. The API resolves absent context to Personal; the active timer's
    // task and workspace are never invocation context for an unrelated interruption.
    create.mutate(next);
  };

  const needsOpen =
    detail?.status === 'awaiting_input' ||
    detail?.status === 'awaiting_approval' ||
    detail?.status === 'failed' ||
    detail?.status === 'canceled';
  const errorCopy = create.isError
    ? create.error instanceof ApiRequestError && create.error.status === 409
      ? 'Create your Personal workspace to hand this off.'
      : 'Athena could not take that just now.'
    : live.isError
      ? 'Could not refresh the latest handoff.'
      : null;

  return (
    <section aria-label="Athena handoff" className="flex flex-col gap-2">
      <form onSubmit={submit} className="relative flex min-w-0 items-center">
        <Sparkles
          aria-hidden="true"
          className="text-on-surface-variant pointer-events-none absolute left-3 size-4"
        />
        <input
          type="text"
          value={prompt}
          aria-label="Hand something to Athena"
          placeholder="Hand something to Athena…"
          autoComplete="off"
          onChange={(event) => {
            setPrompt(event.target.value);
          }}
          className="border-outline-variant bg-surface text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-primary text-body-small h-11 min-w-0 flex-1 rounded-xl border pr-11 pl-9 outline-none focus:ring-1"
        />
        <Button
          type="submit"
          variant="ghost"
          controlSize={comfortable ? 'xl' : 'sm'}
          aria-label="Hand to Athena"
          disabled={prompt.trim().length === 0 || create.isPending}
          className="absolute right-0.5 size-10 px-0"
        >
          <ArrowUp aria-hidden="true" />
        </Button>
      </form>

      {create.isPending ? (
        <Text token="body-small" role="status" tone="muted">
          Athena is handling it.
        </Text>
      ) : detail ? (
        <div className="flex items-center justify-between gap-3" role="status">
          <Text token="body-small" tone="muted">
            {receiptFor(detail.status)}
          </Text>
          {needsOpen ? (
            <Link
              href={athenaHref(null, detail.id)}
              className="text-primary text-label-medium focus-visible:ring-ring rounded-sm underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
            >
              Open
            </Link>
          ) : null}
        </div>
      ) : errorCopy ? (
        <Text token="body-small" role="status" className="text-error">
          {errorCopy}
        </Text>
      ) : null}
    </section>
  );
}
