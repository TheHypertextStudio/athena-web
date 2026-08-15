'use client';

/**
 * `entity-display/use-work-status` — resolve a container's stored status key for display.
 *
 * @remarks
 * Task rows carry their own resolved category on the wire, so they need no lookup at all. The
 * container DTOs — `ProjectOut`, `ProgramOut`, `InitiativeOut` — carry only a key into the
 * workspace's set, so a surface showing one has to ask the registry what that key means.
 *
 * Kept apart from {@link import('./work-status').WorkStatusBadge} and its siblings so that module
 * stays a leaf: the field catalogs import it, and a catalog has no business pulling a query client
 * into a unit test through a transitive import.
 */
import type { WorkStatusEntityType } from '@docket/types';
import { useCallback, useEffect, useRef } from 'react';

import { useStatusRegistry } from '@/components/statuses/status-registry';
import type { CategoryOfState } from '@/lib/work-category';

import { type WorkStatusDisplay, unknownStatus } from './work-status';

/**
 * A stable resolver from a stored status key to its category.
 *
 * @remarks
 * The bridge every pure helper and screen hook takes as a parameter. Memoized on the registry so
 * passing it into a `useMemo`/`useCallback` dependency list does not re-run the work on each
 * render.
 *
 * @param entityType - Which of the workspace's sets the keys belong to.
 * @returns the resolver, defaulting to `backlog` for a key the set no longer holds.
 */
export function useCategoryOf(entityType: WorkStatusEntityType): CategoryOfState {
  const registry = useStatusRegistry();
  return useCallback((key) => registry.categoryOf(entityType, key), [registry, entityType]);
}

/**
 * Resolve a stored status key into what to render for it.
 *
 * @param entityType - Which of the workspace's sets the key belongs to.
 * @param key - The stored status key.
 * @returns the name and category to render.
 *
 * @example
 * ```tsx
 * const status = useWorkStatus('project', project.status);
 * return <WorkStatusBadge name={status.name} category={status.category} />;
 * ```
 */
export function useWorkStatus(entityType: WorkStatusEntityType, key: string): WorkStatusDisplay {
  const registry = useStatusRegistry();
  return registry.statusOf(entityType, key) ?? unknownStatus(key);
}

/**
 * Resolve many status keys of one kind at once.
 *
 * @remarks
 * For a list row rendered inside a `.map`, where calling a hook per row is not an option. The
 * returned resolver is a plain function over the set the registry already holds.
 *
 * @param entityType - Which of the workspace's sets the keys belong to.
 * @returns a resolver from a stored key to its display.
 *
 * @example
 * ```tsx
 * const statusOf = useWorkStatusResolver('project');
 * projects.map((project) => {
 *   const status = statusOf(project.status);
 *   return <WorkStatusBadge key={project.id} name={status.name} category={status.category} />;
 * });
 * ```
 */
export function useWorkStatusResolver(
  entityType: WorkStatusEntityType,
): (key: string) => WorkStatusDisplay {
  const registry = useStatusRegistry();
  return (key) => registry.statusOf(entityType, key) ?? unknownStatus(key);
}

/**
 * Keep a composer's status field on a key the workspace's set actually holds.
 *
 * @remarks
 * Each create composer opened with a status written into its empty draft — `planned` for a
 * Project, `active` for a Program and an Initiative. Those are the keys a *new* workspace seeds,
 * and nothing more: a workspace that renamed its first stage got a composer whose picker showed no
 * selection and whose submit carried a status the workspace does not have.
 *
 * So the default comes from the set instead. Written as a correction rather than an initial value
 * because the set arrives asynchronously and a composer can retarget its workspace while open;
 * both land here as "the current key is not in the set", and both want the same answer. It can
 * never overwrite a deliberate choice, because every key a person can pick comes from the set.
 *
 * @param entityType - Which of the workspace's sets the field draws from.
 * @param status - The key the draft currently holds.
 * @param onDefault - Called with the set's default key when the draft holds something else.
 *
 * @example
 * ```tsx
 * useDefaultedStatus('project', draft.status, (key) => {
 *   setField('status', key);
 * });
 * ```
 */
export function useDefaultedStatus(
  entityType: WorkStatusEntityType,
  status: string,
  onDefault: (key: string) => void,
): void {
  const registry = useStatusRegistry();
  // Held in a ref so a caller may pass an inline arrow without the effect re-running each render.
  const apply = useRef(onDefault);
  apply.current = onDefault;

  const known = registry.statusOf(entityType, status) !== undefined;
  const fallback = registry.defaultOf(entityType)?.key;

  useEffect(() => {
    if (known || fallback === undefined) return;
    apply.current(fallback);
  }, [known, fallback]);
}
