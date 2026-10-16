'use client';
import type { JSX } from 'react';
import { Field, Select } from '@docket/ui/primitives';
import { SettingsGroup } from '@/components/settings/settings-group';
import { SETTINGS_NODES } from '@/components/settings/settings-capabilities';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { QueryLoadFailure } from '@/components/feedback';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

/** Only workspace managers may change who can author or publish work templates. */
export function WorkTemplateAuthoringSetting({ orgId }: { orgId: string }): JSX.Element {
  const query = useApiQuery(
    apiQueryOptions(
      queryKeys.organization(orgId),
      () => api.v1.orgs[':orgId'].$get({ param: { orgId } }),
      'Could not load workspace settings.',
    ),
  );
  const { canManage } = useCanManageOrg(orgId);
  const save = useApiMutation({
    mutationFn: (workTemplateAuthoring: 'contributors' | 'admins') =>
      unwrap(
        () => api.v1.orgs[':orgId'].$patch({ param: { orgId }, json: { workTemplateAuthoring } }),
        'Could not save template permissions.',
      ),
    invalidateKeys: [queryKeys.organization(orgId), queryKeys.templates(orgId)],
  });
  return (
    <SettingsGroup capability={SETTINGS_NODES.templatesAuthoring}>
      {query.isError ? (
        <QueryLoadFailure title="Template permissions" query={query} />
      ) : (
        <Field label="Who can author templates">
          <Select
            value={query.data?.workTemplateAuthoring ?? 'contributors'}
            disabled={!canManage || query.isPending || save.isPending}
            onChange={(event) => {
              save.mutate(event.target.value === 'admins' ? 'admins' : 'contributors');
            }}
          >
            <option value="contributors">Contributors and admins</option>
            <option value="admins">Admins only</option>
          </Select>
        </Field>
      )}
    </SettingsGroup>
  );
}
