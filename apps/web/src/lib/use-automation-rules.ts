/**
 * Data hook for the automation-rules settings surface.
 *
 * @remarks
 * Lists the org's automation rules and exposes enable/disable + delete. Rules are data
 * (`on → when → then`); shipped defaults arrive as `isSeed` rows the user can toggle or
 * delete. Editing predicates/actions is a future surface — this v1 covers list + toggle +
 * delete. See `docs/engineering/specs/email-to-task.md` §7/§9.
 */
import type { AutomationRuleOut } from '@docket/types';
import type { QueryKey } from '@tanstack/react-query';
import { useMemo } from 'react';

import { api } from './api';
import { userErrorMessage } from './problem';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from './query';

/** All automation-rule data + mutation callbacks for the settings surface. */
export interface AutomationRulesData {
  rules: readonly AutomationRuleOut[];
  isPending: boolean;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  actionError: string | null;
}

/**
 * Fetch the org's automation rules and expose enable/disable + delete.
 *
 * @param orgId - The active organization id.
 */
export function useAutomationRules(orgId: string): AutomationRulesData {
  const key = useMemo<QueryKey>(() => queryKeys.automationRules(orgId), [orgId]);

  const listQ = useApiQuery(
    apiQueryOptions(
      key,
      () => api.v1.orgs[':orgId']['automation-rules'].$get({ param: { orgId } }),
      'Could not load automation rules.',
    ),
  );

  const toggleM = useApiMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId']['automation-rules'][':id'].$patch({
            param: { orgId, id: input.id },
            json: { enabled: input.enabled },
          }),
        'Could not update the rule.',
      ),
    invalidateKeys: [key],
  });

  const removeM = useApiMutation({
    mutationFn: (id: string) =>
      unwrap(
        () => api.v1.orgs[':orgId']['automation-rules'][':id'].$delete({ param: { orgId, id } }),
        'Could not delete the rule.',
      ),
    invalidateKeys: [key],
  });

  return {
    rules: listQ.data?.items ?? [],
    isPending: listQ.isPending,
    setEnabled: async (id, enabled) => void (await toggleM.mutateAsync({ id, enabled })),
    remove: async (id) => void (await removeM.mutateAsync(id)),
    actionError: toggleM.error
      ? userErrorMessage(toggleM.error, 'Could not update that automation rule.')
      : removeM.error
        ? userErrorMessage(removeM.error, 'Could not remove that automation rule.')
        : null,
  };
}
