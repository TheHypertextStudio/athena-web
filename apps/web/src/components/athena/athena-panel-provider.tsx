'use client';

import { Sparkles, X } from '@docket/ui/icons';
import {
  Button,
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  Skeleton,
} from '@docket/ui/primitives';
import Link from 'next/link';
import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  athenaHref,
  personalAthenaDetailDef,
  personalAthenaQueueDef,
  personalAthenaTransport,
  type PersonalAthenaLifecycle,
  type PersonalAthenaTransport,
} from '@/lib/athena/query-defs';
import type { PersonalAthenaContext, PersonalAthenaSessionDetail } from '@/lib/athena/presentation';
import { queryKeys, unwrap, useApiMutation, useLiveApiQuery } from '@/lib/query';

import { AthenaWorkbench } from './athena-workbench';

/** Whether a keydown event is the personal Athena shortcut. */
export function isAthenaShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'j';
}

/** Global personal Athena controls available to every contextual entry point. */
export interface AthenaPanelValue {
  readonly open: boolean;
  readonly context: PersonalAthenaContext | null;
  readonly openAthena: (context?: PersonalAthenaContext | null, draft?: string) => void;
  readonly closeAthena: () => void;
}

const AthenaPanelContext = createContext<AthenaPanelValue | null>(null);

/** Props for the global personal Athena layer. */
export interface AthenaPanelProviderProps {
  readonly children: ReactNode;
  readonly context?: PersonalAthenaContext | null;
  readonly transport?: PersonalAthenaTransport;
  readonly showPulse?: boolean;
}

/**
 * Provide the global Athena pulse and contextual dock.
 *
 * @remarks
 * Personal Athena is available without an active workspace, including the Hub. Opening from a
 * concrete Docket object replaces only the dock's invocation context; work remains user-owned.
 */
export function AthenaPanelProvider({
  children,
  context: initialContext = null,
  transport = personalAthenaTransport,
  showPulse = true,
}: AthenaPanelProviderProps): JSX.Element {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<PersonalAthenaContext | null>(initialContext);
  const [selectedId, setSelectedId] = useState('');
  const [launchDraft, setLaunchDraft] = useState<string | null>(null);
  const queue = useLiveApiQuery(personalAthenaQueueDef(transport), 5_000);
  const shellWorkspaceId = initialContext?.workspaceId;
  const shellWorkspaceName = initialContext?.workspaceName;

  useEffect(() => {
    setContext((current) => {
      if (current?.source && current.workspaceId === shellWorkspaceId) return current;
      return shellWorkspaceId || shellWorkspaceName
        ? {
            ...(shellWorkspaceId ? { workspaceId: shellWorkspaceId } : {}),
            ...(shellWorkspaceName ? { workspaceName: shellWorkspaceName } : {}),
          }
        : null;
    });
  }, [shellWorkspaceId, shellWorkspaceName]);

  const preferredId =
    queue.data?.sessions.needsYou[0]?.id ??
    queue.data?.sessions.working[0]?.id ??
    queue.data?.currentChat?.id ??
    '';
  useEffect(() => {
    if (!selectedId && preferredId) setSelectedId(preferredId);
  }, [preferredId, selectedId]);

  const detail = useLiveApiQuery(personalAthenaDetailDef(selectedId, transport), 3_000);
  const selected = detail.data ?? null;

  const openAthena = useCallback((nextContext?: PersonalAthenaContext | null, draft?: string) => {
    if (nextContext !== undefined) setContext(nextContext);
    if (draft?.trim()) setLaunchDraft(draft.trim());
    setOpen(true);
  }, []);
  const closeAthena = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isAthenaShortcut(event)) return;
      event.preventDefault();
      setOpen((current) => !current);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const updateSelected = useCallback(
    (next: PersonalAthenaSessionDetail): void => {
      queryClient.setQueryData(queryKeys.athenaSession(next.id), next);
      setSelectedId(next.id);
    },
    [queryClient],
  );

  const message = useApiMutation<PersonalAthenaSessionDetail, string>({
    mutationFn: (body) =>
      unwrap(() => transport.message(selectedId, { body }), 'Could not steer this Athena work.'),
    invalidateKeys: [queryKeys.athena()],
    onSuccess: updateSelected,
  });
  const lifecycle = useApiMutation<PersonalAthenaSessionDetail, PersonalAthenaLifecycle>({
    mutationFn: (action) =>
      unwrap(() => transport.lifecycle(selectedId, action), 'Could not change this Athena work.'),
    invalidateKeys: [queryKeys.athena()],
    onSuccess: updateSelected,
  });
  const decide = useApiMutation<
    PersonalAthenaSessionDetail,
    { readonly id: string; readonly option: string; readonly kind?: 'approval' | 'question' }
  >({
    mutationFn: ({ id, option, kind }) => {
      if (kind === 'question') {
        return unwrap(
          () => transport.decide(id, 'reply', { body: option }),
          'Could not record your answer.',
        );
      }
      const decision = option === 'reject' ? 'reject' : option === 'reply' ? 'reply' : 'approve';
      return unwrap(() => transport.decide(id, decision), 'Could not record your decision.');
    },
    invalidateKeys: [queryKeys.athena()],
    onSuccess: updateSelected,
  });
  const create = useApiMutation<
    PersonalAthenaSessionDetail,
    { readonly prompt: string; readonly context?: PersonalAthenaContext }
  >({
    mutationFn: (input) =>
      unwrap(() => transport.create(input), 'Athena could not start this work.'),
    invalidateKeys: [queryKeys.athena()],
    onSuccess: (next) => {
      updateSelected(next);
      setLaunchDraft(null);
    },
  });

  const value = useMemo<AthenaPanelValue>(
    () => ({ open, context, openAthena, closeAthena }),
    [closeAthena, context, open, openAthena],
  );
  const counts = queue.data?.counts;
  const pending = message.isPending || lifecycle.isPending || decide.isPending || create.isPending;

  return (
    <AthenaPanelContext.Provider value={value}>
      {children}
      {showPulse ? (
        <button
          type="button"
          aria-label="Open Athena"
          onClick={() => {
            openAthena();
          }}
          className="border-outline-variant bg-inverse-surface text-inverse-on-surface focus-visible:ring-ring fixed right-4 bottom-[4.75rem] z-30 flex min-h-12 items-center gap-2 rounded-full border px-4 shadow-lg transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:outline-none lg:right-6 lg:bottom-6"
        >
          <Sparkles aria-hidden="true" className="size-4" />
          <span className="text-sm font-semibold">Athena</span>
          {counts && (counts.needsYou > 0 || counts.working > 0) ? (
            <span className="text-inverse-on-surface/80 text-xs tabular-nums">
              {counts.needsYou > 0 ? `${counts.needsYou} needs you` : null}
              {counts.needsYou > 0 && counts.working > 0 ? ' · ' : null}
              {counts.working > 0 ? `${counts.working} working` : null}
            </span>
          ) : null}
          <kbd className="text-inverse-on-surface/60 hidden text-[0.65rem] sm:inline">⌘J</kbd>
        </button>
      ) : null}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          aria-describedby={undefined}
          className="@container flex w-[36rem] max-w-[96vw] flex-col overflow-hidden p-0"
        >
          <div className="border-outline-variant bg-surface-container-low flex min-h-14 shrink-0 items-center gap-3 border-b px-4">
            <SheetTitle asChild>
              <span className="text-on-surface flex items-center gap-2 font-semibold">
                <Sparkles aria-hidden="true" className="text-primary size-4" />
                Athena
              </span>
            </SheetTitle>
            <div className="text-on-surface-variant flex min-w-0 flex-1 items-center gap-2 text-xs">
              {counts ? (
                <>
                  <span>{counts.needsYou} needs you</span>
                  <span aria-hidden="true">·</span>
                  <span>{counts.working} working</span>
                </>
              ) : null}
              {context?.source?.label ? (
                <span className="border-outline-variant ml-auto max-w-40 truncate border-l pl-2">
                  {context.source.label}
                </span>
              ) : null}
            </div>
            <Button variant="ghost" size="sm" className="min-h-10" asChild>
              <Link href={athenaHref(context, selectedId)} aria-label="Open full Athena">
                Expand
              </Link>
            </Button>
            <SheetClose asChild>
              <Button variant="ghost" size="icon" aria-label="Close Athena" className="size-10">
                <X aria-hidden="true" className="size-4" />
              </Button>
            </SheetClose>
          </div>

          {queue.isPending || (selectedId && detail.isPending) ? (
            <div className="flex flex-1 flex-col gap-3 p-4" aria-label="Loading Athena work">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-4/5" />
            </div>
          ) : queue.isError || detail.isError ? (
            <p role="status" className="text-on-surface-variant p-6 text-sm">
              Athena is temporarily unavailable. We&apos;ll keep checking.
            </p>
          ) : launchDraft !== null ? (
            <form
              aria-label="Start Athena work"
              className="flex flex-1 flex-col justify-end gap-3 p-4"
              onSubmit={(event) => {
                event.preventDefault();
                const prompt = launchDraft.trim();
                if (!prompt) return;
                create.mutate({ prompt, ...(context ? { context } : {}) });
              }}
            >
              <div>
                <h2 className="text-on-surface text-lg font-semibold">Start this work</h2>
                <p className="text-on-surface-variant mt-1 text-sm">
                  Athena will keep moving in the background. You can return here to steer it.
                </p>
              </div>
              <textarea
                aria-label="Athena objective"
                rows={5}
                value={launchDraft}
                disabled={create.isPending}
                onChange={(event) => {
                  setLaunchDraft(event.target.value);
                }}
                className="border-outline-variant bg-surface-container-low text-on-surface focus-visible:ring-ring w-full resize-none rounded-lg border p-3 text-sm leading-6 outline-none focus-visible:ring-2"
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-10"
                  onClick={() => {
                    setLaunchDraft(null);
                  }}
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  className="min-h-10"
                  disabled={create.isPending || !launchDraft.trim()}
                >
                  {create.isPending ? 'Starting…' : 'Start work'}
                </Button>
              </div>
            </form>
          ) : selected ? (
            <AthenaWorkbench
              session={selected}
              pending={pending}
              onMessage={(body) => {
                message.mutate(body);
              }}
              onLifecycle={(action) => {
                lifecycle.mutate(action);
              }}
              onDecision={(id, option) => {
                decide.mutate({ id, option, kind: selected.decision?.kind });
              }}
            />
          ) : (
            <div className="flex flex-1 flex-col justify-end p-4">
              <p className="text-on-surface max-w-sm text-lg font-semibold">
                What should Athena move forward?
              </p>
              <p className="text-on-surface-variant mt-1 text-sm">
                Open Athena from work to bring that context with you.
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </AthenaPanelContext.Provider>
  );
}

/** Read the personal Athena controls from a contextual surface. */
export function useAthenaPanel(): AthenaPanelValue {
  const value = useContext(AthenaPanelContext);
  if (value === null) throw new Error('useAthenaPanel must be used within AthenaPanelProvider.');
  return value;
}
