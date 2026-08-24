/**
 * Move DOM focus to an xyflow node inside one selection surface after framing begins.
 *
 * @param surfaceId - Shared selection surface that owns the invoking canvas.
 * @param nodeId - Xyflow node to focus inside that surface.
 */
export function focusCanvasNode(surfaceId: string, nodeId: string): void {
  requestAnimationFrame(() => {
    const surface = [...document.querySelectorAll<HTMLElement>('[data-selection-surface]')].find(
      (candidate) => candidate.dataset['selectionSurface'] === surfaceId,
    );
    const node = [
      ...(surface?.querySelectorAll<HTMLElement>('[role="treeitem"][data-object-id]') ?? []),
    ].find((candidate) => candidate.dataset['objectId'] === nodeId);
    node?.focus({ preventScroll: true });
  });
}
