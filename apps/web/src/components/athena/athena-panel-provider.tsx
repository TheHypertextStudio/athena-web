'use client';

import type { RailPanelStatus } from '@docket/ui/components';
import { Surface } from '@docket/ui/primitives';
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

import type { PersonalAthenaContext } from '@/lib/athena/presentation';
import {
  personalAthenaPulseDef,
  personalAthenaTransport,
  type PersonalAthenaTransport,
} from '@/lib/athena/query-defs';
import { useLiveApiQuery } from '@/lib/query';

import { AthenaRailConversation } from './athena-rail-conversation';
import { usePageContext } from './page-context';

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

/**
 * A one-shot request to seed the composer with an opening line. Each `openAthena` call that
 * carries a non-empty draft produces a new version, which the composer treats as a fresh request
 * to apply even if the text repeats a previous one.
 */
export interface AthenaLaunchDraft {
  readonly text: string;
  readonly version: number;
}

/** State and controls shared by contextual Athena entry points and its utility-rail panel. */
export interface AthenaPanelValue {
  readonly context: PersonalAthenaContext | null;
  readonly launchDraft: AthenaLaunchDraft | null;
  readonly railStatus: RailPanelStatus | null;
  /** Whether the next piece of work carries the current context. */
  readonly contextAttached: boolean;
  /** Carry the current page with the next piece of work. */
  readonly attachContext: () => void;
  /** Send the next piece of work without the current page. */
  readonly detachContext: () => void;
  readonly openAthena: (context?: PersonalAthenaContext | null, draft?: string) => void;
  readonly closeAthena: () => void;
  /** What a route asked the rail's Athena panel to show in place of the conversation, if anything. */
  readonly railContent: ReactNode | null;
  /**
   * Hand the rail's Athena panel this content while the route is mounted: a surface whose subject
   * is a conversation shows it where the shell keeps a peer of `<main>`. Returns the release;
   * call it on unmount.
   */
  readonly provideRailContent: (content: ReactNode) => () => void;
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

/** The rail content a route provides while mounted; releasing it restores the conversation. */
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
 * and the full `/athena` route remains the place for broad operations work. The rail shows the
 * person's one conversation by default; `/athena` keeps the job queue until Phase 2 brings
 * delegated work into the thread itself.
 */
export function AthenaPanelProvider({
  children,
  transport = personalAthenaTransport,
  onRevealRail,
  // The queue this gated is gone; kept only because the shell still passes it and may again once
  // delegated work returns to the rail.
  railVisible: _railVisible = false,
  onOpenFullAthena,
}: AthenaPanelProviderProps): JSX.Element {
  const pageContext = usePageContext();
  const [context, setContext] = useState<PersonalAthenaContext | null>(pageContext);
  const [launchDraft, setLaunchDraft] = useState<AthenaLaunchDraft | null>(null);
  const [contextAttached, setContextAttached] = useState(true);
  const pulse = useLiveApiQuery(personalAthenaPulseDef(transport), 5_000);

  // The page moves under the panel; the panel's context always follows it. An explicit context
  // passed to `openAthena` applies immediately (the `setContext` call below) and lasts only until
  // the page context next changes, at which point this effect takes back over.
  useEffect(() => {
    setContext(pageContext);
  }, [pageContext]);

  const reveal = useAthenaReveal(onRevealRail, onOpenFullAthena);
  const { railContent, provideRailContent } = useRailContent();
  const openAthena = useCallback(
    (nextContext?: PersonalAthenaContext | null, draft?: string) => {
      const effective =
        nextContext === undefined && pageContext?.source ? pageContext : nextContext;
      const startsNewWork = effective !== undefined;
      const resolvedContext = effective === undefined ? pageContext : effective;
      setContext(resolvedContext);
      setContextAttached(true);
      const trimmedDraft = draft?.trim();
      if (trimmedDraft) {
        setLaunchDraft((previous) => ({
          text: trimmedDraft,
          version: (previous?.version ?? 0) + 1,
        }));
      }
      reveal(resolvedContext, startsNewWork ? draft : undefined);
    },
    [pageContext, reveal],
  );
  const closeAthena = useCallback(() => {
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
      launchDraft,
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
    }),
    [
      closeAthena,
      context,
      contextAttached,
      launchDraft,
      openAthena,
      railStatus,
      railContent,
      provideRailContent,
    ],
  );

  return <AthenaPanelContext.Provider value={value}>{children}</AthenaPanelContext.Provider>;
}

/** The rail before a workspace is known. One line; the shell resolves one on every work route. */
function AthenaRailNoWorkspace(): JSX.Element {
  return (
    <p role="status" className="text-on-surface-variant text-body-medium p-4">
      Open a workspace to talk to Athena.
    </p>
  );
}

/**
 * Render Athena's compact rail: a route's own conversation when one provides it, else the
 * person's one conversation for the current workspace.
 */
export function AthenaRailPanel(): JSX.Element {
  const { railContent, context } = useAthenaPanel();
  const orgId = context?.workspaceId;
  return (
    <Surface
      as="section"
      tone="page"
      shape="none"
      className="flex h-full min-h-0 flex-col"
      aria-label="Athena"
    >
      {railContent ??
        (orgId ? <AthenaRailConversation orgId={orgId} /> : <AthenaRailNoWorkspace />)}
    </Surface>
  );
}

/** Read Athena controls from a contextual surface. */
export function useAthenaPanel(): AthenaPanelValue {
  const value = useContext(AthenaPanelContext);
  if (value === null) throw new Error('useAthenaPanel must be used within AthenaPanelProvider.');
  return value;
}
