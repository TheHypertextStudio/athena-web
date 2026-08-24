'use client';

import type { InitiativeOut, ProgramOut, ProjectOut, TaskOut, TeamOut } from '@docket/types';
import { useContextState } from '@docket/ui/components';
import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useActiveOrg } from '@/components/active-org';

import { CreationContextProvider } from './creation-context';

export { type CompleteCreateObjectOptions, completeCreateObject } from './create-object-completion';

/** Behavior shared by every supported create request. */
interface CreateObjectRequestBase {
  /** Destination chosen by the launcher; omitted to snapshot the shell workspace at open time. */
  readonly initialWorkspaceId?: string | null;
}

/**
 * Same-workspace navigation policy applied after a successful create.
 *
 * @remarks
 * This policy applies only when the selected destination matches the shell workspace. The global
 * composer owns cross-workspace routing and opens the created object's destination instead. Teams
 * use their fixed destination-workspace Teams-page behavior rather than this policy.
 */
export type SameWorkspaceCompletion = 'stay' | 'open';

/** Open the task composer with optional contextual draft defaults. */
export interface CreateTaskRequest extends CreateObjectRequestBase {
  /** Select the task composer. */
  readonly kind: 'task';
  /** Stay on the invoking surface or open the new task when creation stays in the shell workspace. */
  readonly sameWorkspaceCompletion: SameWorkspaceCompletion;
  /** Notify the launcher after the task is created. */
  readonly onCreated?: (task: TaskOut) => void;
  /**
   * Run destination-independent follow-up work after every successful Task creation.
   *
   * @remarks
   * Unlike {@link CreateTaskRequest.onCreated}, this continuation also runs after cross-workspace
   * and repeat creation. It is reserved for domain work that remains valid after retargeting, such
   * as linking the new Task to an Agenda item; it must not rebind or navigate the invoking page.
   */
  readonly afterCreate?: (task: TaskOut) => void | Promise<void>;
  /** Preselect a project in the new task draft. */
  readonly defaultProjectId?: string | null;
  /** Preselect an assignee in the new task draft. */
  readonly defaultAssigneeId?: string | null;
  /** Apply this task template when the composer opens. */
  readonly defaultTemplateId?: string | null;
}

/** Open the project composer with optional contextual draft defaults. */
export interface CreateProjectRequest extends CreateObjectRequestBase {
  /** Select the project composer. */
  readonly kind: 'project';
  /** Stay on the invoking surface or open the new project within the shell workspace. */
  readonly sameWorkspaceCompletion: SameWorkspaceCompletion;
  /** Notify the launcher after the project is created. */
  readonly onCreated?: (project: ProjectOut) => void;
  /** Preselect a program in the new project draft. */
  readonly defaultProgramId?: string | null;
  /** Apply this project template when the composer opens. */
  readonly defaultTemplateId?: string | null;
}

/** Open the initiative composer with an optional template. */
export interface CreateInitiativeRequest extends CreateObjectRequestBase {
  /** Select the initiative composer. */
  readonly kind: 'initiative';
  /** Stay on the invoking surface or open the new initiative within the shell workspace. */
  readonly sameWorkspaceCompletion: SameWorkspaceCompletion;
  /** Notify the launcher after the initiative is created. */
  readonly onCreated?: (initiative: InitiativeOut) => void;
  /** Apply this initiative template when the composer opens. */
  readonly defaultTemplateId?: string | null;
}

/** Open the program composer with an optional template. */
export interface CreateProgramRequest extends CreateObjectRequestBase {
  /** Select the program composer. */
  readonly kind: 'program';
  /** Stay on the invoking surface or open the new program within the shell workspace. */
  readonly sameWorkspaceCompletion: SameWorkspaceCompletion;
  /** Notify the launcher after the program is created. */
  readonly onCreated?: (program: ProgramOut) => void;
  /** Apply this program template when the composer opens. */
  readonly defaultTemplateId?: string | null;
}

/**
 * Open the team composer.
 *
 * @remarks
 * Teams deliberately have no same-workspace completion option. A successful Team create always
 * opens the destination workspace's Teams page because Team has no standalone detail route.
 */
export interface CreateTeamRequest extends CreateObjectRequestBase {
  /** Select the team composer. */
  readonly kind: 'team';
  /** Notify the launcher after the team is created. */
  readonly onCreated?: (team: TeamOut) => void;
}

/**
 * A request for one of the five object kinds owned by the global creation surface.
 *
 * @remarks
 * The discriminator is intentionally closed. Cycles and workspaces retain their separate flows,
 * so adding either here would silently widen the product contract this provider is responsible
 * for.
 */
export type CreateObjectRequest =
  | CreateTaskRequest
  | CreateProjectRequest
  | CreateInitiativeRequest
  | CreateProgramRequest
  | CreateTeamRequest;

/** Global create controls shared by shell and page launchers. */
export interface CreateObjectValue {
  /** The active request, or `null` when no creation surface is open. */
  readonly request: CreateObjectRequest | null;
  /** Open the requested composer, snapshot its destination, and retain an optional focus target. */
  readonly openCreate: (request: CreateObjectRequest, returnFocusTo?: HTMLElement | null) => void;
  /** Close the active composer and clear its destination. */
  readonly closeCreate: () => void;
}

interface CreateObjectStateValue extends CreateObjectValue {
  readonly targetWorkspaceId: string | null;
  readonly setTargetWorkspaceId: (workspaceId: string) => void;
}

const CreateObjectContext = createContext<CreateObjectStateValue | null>(null);

/** Props for {@link CreateObjectProvider}. */
export interface CreateObjectProviderProps {
  /** The shell-persistent subtree that may launch or host a create composer. */
  readonly children: ReactNode;
}

/**
 * Own the shell-global create request and its independently selected destination workspace.
 *
 * @remarks
 * Opening without an explicit destination snapshots the shell's current workspace. Later target
 * changes are local to the composer: they do not call `setContext`, write the last-workspace
 * preference, or navigate the background page. The composer-only
 * {@link CreationDestinationProvider} resolves the selected target without owning the page.
 */
export function CreateObjectProvider({ children }: CreateObjectProviderProps): JSX.Element {
  const { activeOrgId: shellWorkspaceId } = useContextState();
  const [request, setRequest] = useState<CreateObjectRequest | null>(null);
  const [targetWorkspaceId, setTargetWorkspaceId] = useState<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const focusRestoreGenerationRef = useRef(0);

  const openCreate = useCallback(
    (nextRequest: CreateObjectRequest, returnFocusTo?: HTMLElement | null): void => {
      const initialWorkspaceId = nextRequest.initialWorkspaceId ?? shellWorkspaceId ?? null;
      focusRestoreGenerationRef.current += 1;
      returnFocusRef.current =
        returnFocusTo ??
        (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      // Persist the resolved workspace with the request, rather than leaving an omitted request
      // value to follow the shell later. Kind bodies use this immutable snapshot to decide whether
      // contextual defaults remain valid after a destination switch.
      setRequest({ ...nextRequest, initialWorkspaceId });
      setTargetWorkspaceId(initialWorkspaceId);
    },
    [shellWorkspaceId],
  );

  const closeCreate = useCallback((): void => {
    const returnFocusTo = returnFocusRef.current;
    const focusRestoreGeneration = focusRestoreGenerationRef.current + 1;
    focusRestoreGenerationRef.current = focusRestoreGeneration;
    returnFocusRef.current = null;
    setRequest(null);
    setTargetWorkspaceId(null);
    const restoreUnclaimedFocus = (): void => {
      const active = document.activeElement;
      if (
        focusRestoreGenerationRef.current === focusRestoreGeneration &&
        returnFocusTo?.isConnected &&
        (active === null || active === document.body || !active.isConnected)
      ) {
        returnFocusTo.focus();
      }
    };
    window.setTimeout(restoreUnclaimedFocus, 0);
    // Radix restores a closing portal to its trigger after the provider unmounts the composer.
    // A canvas menu trigger disappears with that portal, so its later restore can leave focus on
    // body after the first pass succeeded. Retry after the exit frame, but never steal focus that
    // the user has already moved to another connected control.
    window.setTimeout(restoreUnclaimedFocus, 200);
  }, []);

  // A create may open during the shell's brief no-active-workspace frame. Wait for the shell's
  // resolved selection, rather than guessing from membership order, then freeze it exactly once.
  useEffect(() => {
    if (request?.initialWorkspaceId !== null || shellWorkspaceId === null) {
      return;
    }
    // An unresolved opening request is the one exception to the normal immutable snapshot rule:
    // freeze the resolved shell workspace as the initial id while preserving any target the user
    // already selected. Only an untouched null target follows the shell resolution.
    setRequest((current) =>
      current?.initialWorkspaceId === null
        ? { ...current, initialWorkspaceId: shellWorkspaceId }
        : current,
    );
    if (targetWorkspaceId === null) setTargetWorkspaceId(shellWorkspaceId);
  }, [request, shellWorkspaceId, targetWorkspaceId]);

  const value = useMemo<CreateObjectStateValue>(
    () => ({ request, openCreate, closeCreate, targetWorkspaceId, setTargetWorkspaceId }),
    [request, openCreate, closeCreate, targetWorkspaceId],
  );

  return <CreateObjectContext.Provider value={value}>{children}</CreateObjectContext.Provider>;
}

/** Props for {@link CreationDestinationProvider}. */
export interface CreationDestinationProviderProps {
  /** The composer-only subtree that needs destination queries and permissions. */
  readonly children: ReactNode;
}

/**
 * Resolve destination data around the global composers without owning the background page.
 *
 * @remarks
 * The stable {@link CreateObjectProvider} keeps request state above the application page. This
 * provider sits beside that page around the composer hosts, so switching between idle and resolved
 * destination contexts cannot replace or remount the page subtree.
 */
export function CreationDestinationProvider({
  children,
}: CreationDestinationProviderProps): JSX.Element {
  const { orgs } = useActiveOrg();
  const state = useContext(CreateObjectContext);
  if (state === null) {
    throw new Error('CreationDestinationProvider must be used within a <CreateObjectProvider>.');
  }

  return (
    <CreationContextProvider
      workspaces={orgs}
      requestKind={state.request?.kind ?? null}
      targetWorkspaceId={state.targetWorkspaceId}
      onTargetWorkspaceChange={state.setTargetWorkspaceId}
    >
      {children}
    </CreationContextProvider>
  );
}

/**
 * Read the global creation controls.
 *
 * @returns The current create request and its open/close operations.
 * @throws {Error} when called outside the authenticated app shell's provider.
 */
export function useCreateObject(): CreateObjectValue {
  const value = useContext(CreateObjectContext);
  if (value === null) {
    throw new Error('useCreateObject must be used within a <CreateObjectProvider>.');
  }
  return value;
}
