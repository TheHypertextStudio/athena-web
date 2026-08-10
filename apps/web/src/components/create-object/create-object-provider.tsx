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
  useState,
} from 'react';

import { useActiveOrg } from '@/components/active-org';

import { CreationContextProvider } from './creation-context';

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
  /** Open the requested composer and snapshot its initial destination. */
  readonly openCreate: (request: CreateObjectRequest) => void;
  /** Close the active composer and clear its destination. */
  readonly closeCreate: () => void;
}

const CreateObjectContext = createContext<CreateObjectValue | null>(null);

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
 * preference, or navigate the background page. The selected target is resolved by
 * {@link CreationContextProvider}; kind-specific composer bodies will consume that context as they
 * migrate into this shell seam.
 */
export function CreateObjectProvider({ children }: CreateObjectProviderProps): JSX.Element {
  const { activeOrgId: shellWorkspaceId } = useContextState();
  const { orgs } = useActiveOrg();
  const [request, setRequest] = useState<CreateObjectRequest | null>(null);
  const [targetWorkspaceId, setTargetWorkspaceId] = useState<string | null>(null);

  const openCreate = useCallback(
    (nextRequest: CreateObjectRequest): void => {
      const initialWorkspaceId = nextRequest.initialWorkspaceId ?? shellWorkspaceId ?? null;
      // Persist the resolved workspace with the request, rather than leaving an omitted request
      // value to follow the shell later. Kind bodies use this immutable snapshot to decide whether
      // contextual defaults remain valid after a destination switch.
      setRequest({ ...nextRequest, initialWorkspaceId });
      setTargetWorkspaceId(initialWorkspaceId);
    },
    [shellWorkspaceId],
  );

  const closeCreate = useCallback((): void => {
    setRequest(null);
    setTargetWorkspaceId(null);
  }, []);

  // A create may open during the shell's brief no-active-workspace frame. Wait for the shell's
  // resolved selection, rather than guessing from membership order, then freeze it exactly once.
  useEffect(() => {
    if (request?.initialWorkspaceId !== null || shellWorkspaceId === null) {
      return;
    }
    // An unresolved opening request is the one exception to the normal immutable snapshot rule:
    // record the resolved shell workspace in both fields before the destination can change.
    // Subsequent shell navigation and composer retargeting leave this opening classification intact.
    setRequest((current) =>
      current?.initialWorkspaceId === null
        ? { ...current, initialWorkspaceId: shellWorkspaceId }
        : current,
    );
    if (targetWorkspaceId === null) setTargetWorkspaceId(shellWorkspaceId);
  }, [request, shellWorkspaceId, targetWorkspaceId]);

  const value = useMemo<CreateObjectValue>(
    () => ({ request, openCreate, closeCreate }),
    [request, openCreate, closeCreate],
  );

  return (
    <CreateObjectContext.Provider value={value}>
      <CreationContextProvider
        workspaces={orgs}
        requestKind={request?.kind ?? null}
        targetWorkspaceId={targetWorkspaceId}
        onTargetWorkspaceChange={setTargetWorkspaceId}
      >
        {children}
      </CreationContextProvider>
    </CreateObjectContext.Provider>
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
