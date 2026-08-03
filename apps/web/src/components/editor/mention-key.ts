/**
 * The one key shape shared by the mention directory, the title registry, and the node view.
 *
 * @remarks
 * Kept in its own module with no imports so the ProseMirror node view (plain DOM, created
 * outside React) and the React data hook can agree on it without either pulling in the other's
 * dependencies.
 */

/**
 * Build the registry key for one referenced object.
 *
 * @param kind - The object kind, e.g. `project`.
 * @param id - The object id.
 * @returns The `kind:id` key.
 */
export function mentionKeyOf(kind: string, id: string): string {
  return `${kind}:${id}`;
}
