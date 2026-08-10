'use client';

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

/** Open the task composer with optional contextual draft defaults. */
export interface CreateTaskRequest extends CreateObjectRequestBase {
  readonly kind: 'task';
  readonly defaultProjectId?: string | null;
  readonly defaultAssigneeId?: string | null;
  readonly defaultTemplateId?: string | null;
}

/** Open the project composer with optional contextual draft defaults. */
export interface CreateProjectRequest extends CreateObjectRequestBase {
  readonly kind: 'project';
  readonly defaultProgramId?: string | null;
  readonly defaultTemplateId?: string | null;
}

/** Open the initiative composer with an optional template. */
export interface CreateInitiativeRequest extends CreateObjectRequestBase {
  readonly kind: 'initiative';
  readonly defaultTemplateId?: string | null;
}

/** Open the program composer with an optional template. */
export interface CreateProgramRequest extends CreateObjectRequestBase {
  readonly kind: 'program';
  readonly defaultTemplateId?: string | null;
}

/** Open the team composer. */
export interface CreateTeamRequest extends CreateObjectRequestBase {
  readonly kind: 'team';
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
      setRequest(nextRequest);
      setTargetWorkspaceId(
        nextRequest.initialWorkspaceId ?? shellWorkspaceId ?? orgs[0]?.id ?? null,
      );
    },
    [orgs, shellWorkspaceId],
  );

  const closeCreate = useCallback((): void => {
    setRequest(null);
    setTargetWorkspaceId(null);
  }, []);

  // A create may open while the workspace list is still resolving. Choose the shell target once
  // it becomes known, but never follow later shell navigation while a draft is already targeted.
  useEffect(() => {
    if (request === null || targetWorkspaceId !== null) return;
    const fallback = request.initialWorkspaceId ?? shellWorkspaceId ?? orgs[0]?.id ?? null;
    if (fallback !== null) setTargetWorkspaceId(fallback);
  }, [orgs, request, shellWorkspaceId, targetWorkspaceId]);

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
