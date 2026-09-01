'use client';

/**
 * The one place templates are read and written from.
 *
 * @remarks
 * Templates are reached from four surfaces — a composer picker, the settings list, the template
 * editor, and the command palette — and the slash-menu rule applies: one implementation, several
 * entry points. Each surface imports a definition from here rather than reaching for `api.v1.*`.
 *
 * @see `docs/engineering/specs/data-layer.md` for the query-definition standard.
 */
import type {
  TemplateCreate,
  TemplateDraft,
  TemplateOut,
  TemplateTargetType,
  TemplateUpdate,
} from '@docket/work/template-contract';

import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, STALE, unwrap, useApiMutation } from '@/lib/query';

/** Every template in the org, for the settings list. */
export function templatesDef(orgId: string) {
  return apiQueryOptions(
    queryKeys.templates(orgId),
    () => api.v1.orgs[':orgId'].templates.$get({ param: { orgId }, query: {} }),
    'Could not load your templates.',
    // Templates change when someone edits one, which is rare and always invalidates this key
    // explicitly. Re-reading them on every composer open would be a request per open for data
    // that has not moved.
    { staleTime: STALE.static },
  );
}

/** The templates that create one kind, for that kind's composer picker. */
export function templatesOfKindDef(orgId: string, targetType: TemplateTargetType) {
  return apiQueryOptions(
    queryKeys.templatesOfKind(orgId, targetType),
    () => api.v1.orgs[':orgId'].templates.$get({ param: { orgId }, query: { targetType } }),
    'Could not load your templates.',
    { staleTime: STALE.static },
  );
}

/** Create a template. Invalidates every template read in the org. */
export function useCreateTemplate(orgId: string) {
  return useApiMutation({
    mutationFn: (input: TemplateCreate) =>
      unwrap(
        () => api.v1.orgs[':orgId'].templates.$post({ param: { orgId }, json: input }),
        'Could not save the template.',
      ),
    invalidateKeys: [queryKeys.templates(orgId)],
  });
}

/** Update a template. Invalidates every template read in the org. */
export function useUpdateTemplate(orgId: string) {
  return useApiMutation({
    mutationFn: ({ id, ...patch }: TemplateUpdate & { id: string }) =>
      unwrap(
        () => api.v1.orgs[':orgId'].templates[':id'].$patch({ param: { orgId, id }, json: patch }),
        'Could not save the template.',
      ),
    invalidateKeys: [queryKeys.templates(orgId)],
  });
}

/** Delete a template. Invalidates every template read in the org. */
export function useDeleteTemplate(orgId: string) {
  return useApiMutation({
    mutationFn: (id: string) =>
      unwrap(
        () => api.v1.orgs[':orgId'].templates[':id'].$delete({ param: { orgId, id } }),
        'Could not delete the template.',
      ),
    invalidateKeys: [queryKeys.templates(orgId)],
  });
}

/** A template payload for one kind, with the discriminant removed — mergeable into that composer's draft. */
export type TemplatePatch<K extends TemplateTargetType> = Partial<
  Omit<Extract<TemplateDraft, { targetType: K }>, 'targetType'>
>;

/**
 * Narrow a payload to one kind and strip its discriminant, ready to merge into a composer draft.
 *
 * @remarks
 * `targetType` exists to keep the union honest on the wire; no composer holds it as a field. Every
 * other key is named exactly as the draft names it, so the merge is otherwise an identity — which
 * is the point of modelling a payload as a partial of the create body rather than as its own
 * vocabulary.
 *
 * The kind check is not ceremony. A picker only ever lists one kind, but nothing in the type of a
 * `TemplateOut` says so, and a mismatched payload should apply nothing rather than scatter another
 * entity's fields across the draft.
 *
 * @param payload - The stored draft from a {@link TemplateOut}.
 * @param kind - The kind the calling composer creates.
 * @returns the payload's fields, or an empty patch when the payload describes another kind.
 */
export function templatePatch<K extends TemplateTargetType>(
  payload: TemplateDraft,
  kind: K,
): TemplatePatch<K> {
  if (payload.targetType !== kind) return {};
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => key !== 'targetType'),
  ) as TemplatePatch<K>;
}

/**
 * Decide whether a caller-visible template belongs to the selected person/team context.
 *
 * @param template - Template returned after the API enforces personal and team membership scope.
 * @param currentActorId - Signed-in member Actor id in that workspace, or `null` when unresolved.
 * @param teamId - Team currently selected by the composer, or `null` when no team is selected.
 * @returns Whether the template applies in the current creation context.
 */
export function templateMatchesContext(
  template: TemplateOut,
  currentActorId: string | null,
  teamId: string | null,
): boolean {
  if (template.scope === 'organization') return true;
  if (template.scope === 'personal') return template.ownerActorId === currentActorId;
  return template.teamId === teamId;
}

/** Group templates for a picker or a settings list: shared first, then the caller's own. */
export function sortTemplates(items: readonly TemplateOut[]): readonly TemplateOut[] {
  const rank: Record<TemplateOut['scope'], number> = { organization: 0, team: 1, personal: 2 };
  return [...items].sort((a, b) => rank[a.scope] - rank[b.scope] || a.name.localeCompare(b.name));
}
