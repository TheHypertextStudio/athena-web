'use client';

import type { RailPanelStatus } from '@docket/ui/components';
import { Sparkles } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button, Skeleton, Surface, surfaceToneColor } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
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
import { type UseQueryResult, useQueryClient } from '@tanstack/react-query';

import {
  athenaHref,
  personalAthenaDetailDef,
  personalAthenaPulseDef,
  personalAthenaQueueDef,
  personalAthenaTransport,
  type PersonalAthenaQueuePayload,
  type PersonalAthenaTransport,
} from '@/lib/athena/query-defs';
import {
  groupAthenaQueue,
  type PersonalAthenaContext,
  type PersonalAthenaSessionDetail,
  type PersonalAthenaSessionSummary,
} from '@/lib/athena/presentation';
import { queryKeys, useLiveApiQuery } from '@/lib/query';
import MentionTextarea from '@/components/mentions/mention-textarea';
import { useMentionOrgId } from '@/components/mentions/use-mention-org';

import { AthenaContextChip } from './athena-context-chip';
import { AthenaWorkbench } from './athena-workbench';
import { usePageContext } from './page-context';
import { useAthenaActions } from './use-athena-actions';

/** Whether a keydown event is the personal Athena shortcut. */
export function isAthenaShortcut(event: KeyboardEvent): boolean {
  const target = event.target;
  const editable =
    target instanceof Element &&
    (target.matches('input, textarea, select') ||
      target.closest('[contenteditable="true"]') !== null);
  return (
    !event.repeat &&
    !editable &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    event.key.toLowerCase() === 'j'
  );
}

/** State and controls shared by contextual Athena entry points and its utility-rail panel. */
export interface AthenaPanelValue {
  readonly context: PersonalAthenaContext | null;
  readonly selectedId: string;
  readonly launchDraft: string | null;
  readonly selected: PersonalAthenaSessionDetail | null;
  readonly queue: UseQueryResult<PersonalAthenaQueuePayload>;
  readonly detailPending: boolean;
  readonly detailError: boolean;
  readonly pending: boolean;
  readonly createPending: boolean;
  readonly railStatus: RailPanelStatus | null;
  /** Whether the next piece of work carries the current context. */
  readonly contextAttached: boolean;
  /** Carry the current page with the next piece of work. */
  readonly attachContext: () => void;
  /** Send the next piece of work without the current page. */
  readonly detachContext: () => void;
  readonly openAthena: (context?: PersonalAthenaContext | null, draft?: string) => void;
  readonly closeAthena: () => void;
  /** What a route asked the rail's Athena panel to show in place of the queue, if anything. */
  readonly railContent: ReactNode | null;
  /**
   * Hand the rail's Athena panel this content while the route is mounted: a surface whose subject
   * is a conversation shows it where the shell keeps a peer of `<main>`. Returns the release;
   * call it on unmount.
   */
  readonly provideRailContent: (content: ReactNode) => () => void;
  readonly selectSession: (session: PersonalAthenaSessionSummary) => void;
  readonly sendMessage: (body: string) => void;
  readonly lifecycle: (action: 'run' | 'pause' | 'resume' | 'cancel') => void;
  readonly decide: (id: string, option: string) => void;
  readonly create: (prompt: string) => void;
}

const AthenaPanelContext = createContext<AthenaPanelValue | null>(null);

/** Props for the shared Athena session state. */
export interface AthenaPanelProviderProps {
  readonly children: ReactNode;
  readonly transport?: PersonalAthenaTransport | undefined;
  /** Ask the owning shell to select and expand Athena's utility-rail panel. */
  readonly onRevealRail?: (() => void) | undefined;
  /** Whether the shell is currently displaying Athena's rail panel. */
  readonly railVisible?: boolean | undefined;
  /** Open the full Athena workspace when this route deliberately has no utility rail. */
  readonly onOpenFullAthena?:
    ((context: PersonalAthenaContext | null, draft: string | undefined) => void) | undefined;
}

/** Where "open Athena" lands: the shell's rail when it offers one, else the full page. */
function useAthenaReveal(
  onRevealRail: (() => void) | undefined,
  onOpenFullAthena: AthenaPanelProviderProps['onOpenFullAthena'],
): (nextContext: PersonalAthenaContext | null, draft: string | undefined) => void {
  return useCallback(
    (nextContext: PersonalAthenaContext | null, draft: string | undefined): void => {
      if (onRevealRail) {
        onRevealRail();
        return;
      }
      onOpenFullAthena?.(nextContext, draft);
    },
    [onOpenFullAthena, onRevealRail],
  );
}

/** What a route asked the rail's Athena panel to show, and the way to ask. */
interface RailContent {
  readonly railContent: ReactNode | null;
  readonly provideRailContent: (content: ReactNode) => () => void;
}

/** The rail content a route provides while mounted; releasing it restores the queue. */
function useRailContent(): RailContent {
  const [railContent, setRailContent] = useState<ReactNode | null>(null);
  const provideRailContent = useCallback((content: ReactNode): (() => void) => {
    setRailContent(content);
    return () => {
      setRailContent(null);
    };
  }, []);
  return { railContent, provideRailContent };
}

/**
 * Keep Athena's personal session state available to contextual entry points.
 *
 * The provider owns no viewport-level chrome. The shared shell owns where the compact panel opens,
 * and the full `/athena` route remains the place for broad operations work. Selection and any
 * draft survive navigation; only the page context underneath them changes.
 */
export function AthenaPanelProvider({
  children,
  transport = personalAthenaTransport,
  onRevealRail,
  railVisible = false,
  onOpenFullAthena,
}: AthenaPanelProviderProps): JSX.Element {
  const queryClient = useQueryClient();
  const pageContext = usePageContext();
  const [context, setContext] = useState<PersonalAthenaContext | null>(pageContext);
  const [selectedId, setSelectedId] = useState('');
  const [launchDraft, setLaunchDraft] = useState<string | null>(null);
  const [contextAttached, setContextAttached] = useState(true);
  const pulse = useLiveApiQuery(personalAthenaPulseDef(transport), 5_000);
  const queue = useLiveApiQuery(personalAthenaQueueDef(transport, railVisible), 5_000);

  // The page moves under the panel; the panel keeps what the person was doing. Only an idle
  // panel (no selection, no draft) follows the page.
  useEffect(() => {
    if (selectedId || launchDraft !== null) return;
    setContext(pageContext);
  }, [launchDraft, pageContext, selectedId]);

  const detailId = launchDraft === null ? selectedId : '';
  const detail = useLiveApiQuery(personalAthenaDetailDef(detailId, transport, railVisible), 3_000);
  const selected = detail.data ?? null;

  const updateSelected = useCallback(
    (next: PersonalAthenaSessionDetail): void => {
      queryClient.setQueryData(queryKeys.athenaSession(next.id), next);
      setSelectedId(next.id);
    },
    [queryClient],
  );
  const actions = useAthenaActions({
    selectedId,
    transport,
    onSelected: updateSelected,
    onCreated: (next) => {
      updateSelected(next);
      setLaunchDraft(null);
    },
  });

  const reveal = useAthenaReveal(onRevealRail, onOpenFullAthena);
  const { railContent, provideRailContent } = useRailContent();
  const openAthena = useCallback(
    (nextContext?: PersonalAthenaContext | null, draft?: string) => {
      const effective =
        nextContext === undefined && pageContext?.source ? pageContext : nextContext;
      const startsNewWork = effective !== undefined;
      const resolvedContext = effective === undefined ? pageContext : effective;
      setContext(resolvedContext);
      setSelectedId('');
      setContextAttached(true);
      setLaunchDraft(startsNewWork ? (draft?.trim() ?? '') : null);
      reveal(resolvedContext, startsNewWork ? draft : undefined);
    },
    [pageContext, reveal],
  );
  const closeAthena = useCallback(() => {
    setSelectedId('');
    setLaunchDraft(null);
    setContextAttached(true);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isAthenaShortcut(event)) return;
      event.preventDefault();
      openAthena();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openAthena]);

  const railStatus = useMemo<RailPanelStatus | null>(() => {
    const counts = pulse.data;
    if (!counts) return null;
    if (counts.needsYou > 0) {
      return {
        tone: 'attention',
        label: `${counts.needsYou} Athena item${counts.needsYou === 1 ? '' : 's'} need you`,
      };
    }
    if (counts.working > 0) {
      return {
        tone: 'active',
        label: `${counts.working} Athena item${counts.working === 1 ? '' : 's'} working`,
      };
    }
    return null;
  }, [pulse.data]);

  const value = useMemo<AthenaPanelValue>(
    () => ({
      context,
      selectedId,
      launchDraft,
      selected,
      queue,
      detailPending: detail.isPending,
      detailError: detail.isError,
      pending: actions.pending,
      createPending: actions.createPending,
      railStatus,
      contextAttached,
      attachContext: () => {
        setContextAttached(true);
      },
      detachContext: () => {
        setContextAttached(false);
      },
      openAthena,
      closeAthena,
      railContent,
      provideRailContent,
      selectSession: (session) => {
        setLaunchDraft(null);
        setContext({
          ...(session.workspace
            ? { workspaceId: session.workspace.id, workspaceName: session.workspace.name }
            : {}),
          ...(session.context?.source ? { source: session.context.source } : {}),
        });
        setSelectedId(session.id);
      },
      sendMessage: actions.sendMessage,
      lifecycle: actions.lifecycle,
      decide: (id, option) => {
        actions.decide({ id, option, kind: selected?.decision?.kind });
      },
      create: (prompt) => {
        actions.create({ prompt, ...(context && contextAttached ? { context } : {}) });
      },
    }),
    [
      actions,
      closeAthena,
      context,
      contextAttached,
      detail.isPending,
      detail.isError,
      launchDraft,
      openAthena,
      queue,
      railStatus,
      railContent,
      provideRailContent,
      selected,
      selectedId,
    ],
  );

  return <AthenaPanelContext.Provider value={value}>{children}</AthenaPanelContext.Provider>;
}

/**
 * Render Athena's compact rail: a route's own conversation when one provides it, else the queue
 * or one selected work session.
 */
export function AthenaRailPanel(): JSX.Element {
  const { railContent } = useAthenaPanel();
  if (railContent) {
    return (
      <Surface
        as="section"
        tone="page"
        shape="none"
        className="flex h-full min-h-0 flex-col"
        aria-label="Athena"
      >
        {railContent}
      </Surface>
    );
  }
  return <AthenaRailQueue />;
}

/** The queue, or the detail of the item selected in it. */
function AthenaRailQueue(): JSX.Element {
  const athena = useAthenaPanel();
  const groups = useMemo(() => {
    const sessions = athena.queue.data
      ? [
          ...athena.queue.data.sessions.needsYou,
          ...athena.queue.data.sessions.working,
          ...athena.queue.data.sessions.finished,
        ]
      : [];
    return groupAthenaQueue(sessions);
  }, [athena.queue.data]);
  const counts = athena.queue.data?.counts;
  const railHref = athenaHref(
    athena.context,
    athena.launchDraft === null ? athena.selectedId : null,
    athena.launchDraft !== null,
  );

  return (
    <Surface
      as="section"
      tone="page"
      shape="none"
      className="flex h-full min-h-0 flex-col"
      aria-label="Athena"
    >
      <Surface
        as="header"
        tone="card"
        shape="none"
        className="border-outline-variant flex min-h-14 shrink-0 items-center gap-2 border-b px-3"
      >
        {athena.selectedId || athena.launchDraft !== null ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-10"
            onClick={athena.closeAthena}
          >
            Back
          </Button>
        ) : (
          <span className="text-label-large flex min-w-0 flex-1 items-center gap-2">
            <Sparkles aria-hidden="true" className="text-primary size-4 shrink-0" />
            Athena
          </span>
        )}
        {counts ? (
          <span className="text-on-surface-variant text-label-small ml-auto tabular-nums">
            {counts.needsYou > 0 ? `${counts.needsYou} need you` : `${counts.working} working`}
          </span>
        ) : null}
        <Button variant="ghost" size="sm" className="min-h-10" asChild>
          <Link href={railHref} aria-label="Open full Athena">
            Open full
          </Link>
        </Button>
      </Surface>

      {athena.launchDraft !== null ? (
        <AthenaRailComposer />
      ) : athena.queue.isPending || (athena.selectedId && athena.detailPending) ? (
        <div className="flex flex-1 flex-col gap-3 p-3" aria-label="Loading Athena work">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-4/5" />
        </div>
      ) : athena.queue.isError || athena.detailError ? (
        <p role="status" className="text-on-surface-variant text-body-medium p-4">
          Athena is temporarily unavailable. We&apos;ll keep checking.
        </p>
      ) : athena.selected ? (
        <AthenaWorkbench
          session={athena.selected}
          pending={athena.pending}
          onMessage={athena.sendMessage}
          onLifecycle={athena.lifecycle}
          onDecision={athena.decide}
          onStartNewWork={athena.closeAthena}
        />
      ) : (
        <nav aria-label="Athena work" className="min-h-0 flex-1 overflow-y-auto py-2">
          {groups.every((group) => group.items.length === 0) ? (
            <p className="text-on-surface-variant text-body-medium px-3 py-4">
              Start Athena from Today or from a piece of work when it needs context.
            </p>
          ) : (
            groups.map((group) =>
              group.items.length > 0 ? (
                <section key={group.key} aria-labelledby={`athena-rail-${group.key}`}>
                  <div className="text-on-surface-variant text-label-small px-3 pt-3 pb-1">
                    <span id={`athena-rail-${group.key}`}>{group.label}</span>
                    <span className="float-right tabular-nums">{group.items.length}</span>
                  </div>
                  <ul>
                    {group.items.map((session) => (
                      <li key={session.id}>
                        <button
                          type="button"
                          className="hover:bg-surface-container-high focus-visible:ring-ring flex w-full flex-col gap-1 px-3 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
                          onClick={() => {
                            athena.selectSession(session);
                          }}
                        >
                          <span className="text-on-surface text-label-large line-clamp-2">
                            {session.objective}
                          </span>
                          <span className="text-on-surface-variant text-body-small truncate">
                            {session.context?.source?.label ??
                              session.workspace?.name ??
                              'Personal Athena work'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null,
            )
          )}
        </nav>
      )}
    </Surface>
  );
}

/** Render the narrow contextual-work composer shown after an object invokes Athena. */
function AthenaRailComposer(): JSX.Element {
  const athena = useAthenaPanel();
  const [draft, setDraft] = useState(athena.launchDraft ?? '');
  const mentionOrgId = useMentionOrgId(athena.context?.workspaceId);

  return (
    <form
      aria-label="Start Athena work"
      className="flex min-h-0 flex-1 flex-col justify-end gap-3 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const prompt = draft.trim();
        if (prompt) athena.create(prompt);
      }}
    >
      <div>
        <h2 className="text-on-surface text-title-medium">Start this work</h2>
        <p className="text-on-surface-variant text-body-medium mt-1">
          Athena keeps moving in the background. Return here when it needs direction.
        </p>
      </div>
      <AthenaContextChip
        context={athena.context}
        attached={athena.contextAttached}
        onDetach={athena.detachContext}
        onAttach={athena.attachContext}
      />
      <MentionTextarea
        aria-label="Athena objective"
        rows={5}
        value={draft}
        disabled={athena.createPending}
        onChange={setDraft}
        {...(mentionOrgId === undefined ? {} : { orgId: mentionOrgId })}
        insertMode="context"
        className={cn(
          surfaceToneColor('card'),
          'border-outline-variant text-on-surface text-body-medium focus-visible:ring-ring w-full resize-none rounded-lg border p-3 outline-none focus-visible:ring-2',
        )}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" className="min-h-10" onClick={athena.closeAthena}>
          Back
        </Button>
        <Button type="submit" className="min-h-10" disabled={athena.createPending || !draft.trim()}>
          {athena.createPending ? 'Starting…' : 'Start work'}
        </Button>
      </div>
    </form>
  );
}

/** Read Athena controls from a contextual surface. */
export function useAthenaPanel(): AthenaPanelValue {
  const value = useContext(AthenaPanelContext);
  if (value === null) throw new Error('useAthenaPanel must be used within AthenaPanelProvider.');
  return value;
}
