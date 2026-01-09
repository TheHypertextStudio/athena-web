/**
 * Active workspace state management.
 *
 * This hook provides global state for tracking which workspace the user is
 * currently working in. Workspaces scope all data - tasks, projects, events,
 * etc. belong to a specific workspace. The command palette uses this to:
 *
 * 1. Pre-select the active workspace when creating new entities
 * 2. Filter actions that are workspace-specific
 * 3. Show workspace-related actions ("Switch Workspace", etc.)
 *
 * ## Workspace Scoping Model
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                      Workspace Hierarchy                        │
 * │                                                                 │
 * │  ┌─────────────────────────────────────────────────────────────┐│
 * │  │              Personal Workspace (isPersonal: true)          ││
 * │  │  - Default workspace for each user                          ││
 * │  │  - Contains user's personal tasks, projects, etc.           ││
 * │  └─────────────────────────────────────────────────────────────┘│
 * │                                                                 │
 * │  ┌─────────────────────────────────────────────────────────────┐│
 * │  │              Team Workspace A (isPersonal: false)           ││
 * │  │  - Shared with team members                                 ││
 * │  │  - Separate tasks, projects, etc.                           ││
 * │  └─────────────────────────────────────────────────────────────┘│
 * │                                                                 │
 * │  ┌─────────────────────────────────────────────────────────────┐│
 * │  │              Team Workspace B (isPersonal: false)           ││
 * │  │  - Another team's workspace                                 ││
 * │  │  - Completely isolated data                                 ││
 * │  └─────────────────────────────────────────────────────────────┘│
 * └─────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## API Integration
 *
 * The active workspace is sent with API requests via the `X-Workspace-Id` header.
 * This ensures all queries and mutations are scoped to the correct workspace.
 *
 * ```typescript
 * // In API client
 * const headers = {
 *   'Content-Type': 'application/json',
 *   'X-Workspace-Id': getWorkspaceState().workspace?.id,
 * };
 * ```
 *
 * ## Persistence
 *
 * The active workspace selection is persisted to localStorage so users return
 * to their last-used workspace. The available workspaces list is NOT persisted
 * as it should be fetched fresh on each session.
 *
 * ## Usage
 *
 * ```typescript
 * // In a workspace switcher component
 * function WorkspaceSwitcher() {
 *   const {
 *     workspace,
 *     availableWorkspaces,
 *     setWorkspace,
 *     setAvailableWorkspaces,
 *   } = useActiveWorkspace();
 *
 *   // Fetch workspaces on mount
 *   const { data: workspaces } = useQuery({
 *     queryKey: ['workspaces'],
 *     queryFn: () => workspacesApi.list(),
 *   });
 *
 *   // Update available workspaces when loaded
 *   useEffect(() => {
 *     if (workspaces) {
 *       setAvailableWorkspaces(workspaces);
 *       // Auto-select personal workspace if none selected
 *       if (!workspace) {
 *         const personal = workspaces.find(w => w.isPersonal);
 *         if (personal) setWorkspace(personal);
 *       }
 *     }
 *   }, [workspaces]);
 *
 *   return (
 *     <Select
 *       value={workspace?.id}
 *       onValueChange={(id) => {
 *         const ws = availableWorkspaces.find(w => w.id === id);
 *         if (ws) setWorkspace(ws);
 *       }}
 *     >
 *       {availableWorkspaces.map(ws => (
 *         <SelectItem key={ws.id} value={ws.id}>{ws.name}</SelectItem>
 *       ))}
 *     </Select>
 *   );
 * }
 * ```
 *
 * @packageDocumentation
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WorkspaceContext } from '@/lib/command-palette/types';

/**
 * Internal store state and actions for workspace management.
 */
interface WorkspaceStore {
  /**
   * The currently active workspace.
   *
   * All entity operations (create, read, update, delete) are scoped to this
   * workspace. If null, no workspace is selected (rare edge case, usually
   * during initial load).
   */
  workspace: WorkspaceContext | null;

  /**
   * All workspaces the user has access to.
   *
   * Populated from the API on app load. Used to render workspace switcher
   * and validate workspace selection.
   */
  availableWorkspaces: WorkspaceContext[];

  /**
   * Set the active workspace.
   *
   * Called when user switches workspaces or on initial selection.
   * Triggers a re-render of any components using this hook, and
   * subsequent API calls will use the new workspace ID.
   *
   * @param workspace - The workspace to make active, or null to clear
   */
  setWorkspace: (workspace: WorkspaceContext | null) => void;

  /**
   * Update the list of available workspaces.
   *
   * Called after fetching workspaces from the API. This should include
   * both the user's personal workspace and any team workspaces they
   * belong to.
   *
   * @param workspaces - Array of workspace contexts
   */
  setAvailableWorkspaces: (workspaces: WorkspaceContext[]) => void;
}

/**
 * Zustand store for workspace state with localStorage persistence.
 *
 * The `workspace` selection is persisted so users return to their
 * last-used workspace. The `availableWorkspaces` list is NOT persisted
 * because it should be fetched fresh (workspaces may have been added/removed).
 */
const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set) => ({
      workspace: null,
      availableWorkspaces: [],

      setWorkspace: (workspace) => {
        set({ workspace });
      },

      setAvailableWorkspaces: (availableWorkspaces) => {
        set({ availableWorkspaces });
      },
    }),
    {
      name: 'athena-workspace', // localStorage key
      /**
       * Only persist the workspace selection, not the full list.
       * The list should be fetched fresh on each session.
       */
      partialize: (state) => ({
        workspace: state.workspace,
      }),
    },
  ),
);

/**
 * Hook to access and modify the active workspace.
 *
 * Returns the current workspace, available workspaces, and functions
 * to modify them. Components that need workspace context should use
 * this hook.
 *
 * @returns Object with workspace state and control functions
 *
 * @example
 * // Reading the active workspace
 * function DashboardHeader() {
 *   const { workspace } = useActiveWorkspace();
 *
 *   return (
 *     <header>
 *       <h1>{workspace?.name ?? 'No workspace selected'}</h1>
 *     </header>
 *   );
 * }
 *
 * @example
 * // Pre-selecting workspace in a form
 * function CreateTaskForm() {
 *   const { workspace, availableWorkspaces } = useActiveWorkspace();
 *
 *   return (
 *     <form>
 *       <select defaultValue={workspace?.id}>
 *         {availableWorkspaces.map(ws => (
 *           <option key={ws.id} value={ws.id}>{ws.name}</option>
 *         ))}
 *       </select>
 *     </form>
 *   );
 * }
 */
export function useActiveWorkspace(): WorkspaceStore {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const availableWorkspaces = useWorkspaceStore((s) => s.availableWorkspaces);
  const setWorkspace = useWorkspaceStore((s) => s.setWorkspace);
  const setAvailableWorkspaces = useWorkspaceStore((s) => s.setAvailableWorkspaces);
  return { workspace, availableWorkspaces, setWorkspace, setAvailableWorkspaces };
}

/**
 * Direct access to get workspace state outside of React components.
 *
 * Use this for synchronous access in non-React code, such as:
 * - API client headers
 * - Action execution functions
 * - Middleware
 *
 * For React components, always prefer the `useActiveWorkspace()` hook
 * to get proper reactivity.
 *
 * @returns Current workspace state snapshot
 *
 * @example
 * // In an API client
 * function getHeaders(): HeadersInit {
 *   const { workspace } = getWorkspaceState();
 *   return {
 *     'Content-Type': 'application/json',
 *     ...(workspace && { 'X-Workspace-Id': workspace.id }),
 *   };
 * }
 *
 * @example
 * // In a command palette action
 * const createTaskAction: ExecutableAction = {
 *   form: (ctx) => ({
 *     fields: [{
 *       name: 'workspaceId',
 *       type: 'select',
 *       defaultValue: ctx.workspace?.id,
 *       options: () => {
 *         const { availableWorkspaces } = getWorkspaceState();
 *         return availableWorkspaces.map(ws => ({
 *           value: ws.id,
 *           label: ws.name,
 *         }));
 *       },
 *     }],
 *   }),
 * };
 */
export function getWorkspaceState(): Pick<WorkspaceStore, 'workspace' | 'availableWorkspaces'> {
  const state = useWorkspaceStore.getState();
  return {
    workspace: state.workspace,
    availableWorkspaces: state.availableWorkspaces,
  };
}
