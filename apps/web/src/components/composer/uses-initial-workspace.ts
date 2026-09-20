/** Whether contextual defaults still belong to the composer's current destination. */
export function usesInitialWorkspace(
  destination:
    | { readonly targetWorkspaceId: string | null; readonly initialWorkspaceId: string | null }
    | undefined,
): boolean {
  return (
    destination === undefined || destination.targetWorkspaceId === destination.initialWorkspaceId
  );
}
