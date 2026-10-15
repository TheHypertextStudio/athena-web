'use client';
import { useState, type JSX } from 'react';
import { useVocabulary } from '@docket/ui/hooks';
import { Button, Field, Select } from '@docket/ui/primitives';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import type { TemplateTargetType } from '@docket/work/template-contract';
import { WorkTemplateGuidedCreate } from './work-template-guided-create';
import { QueryLoadFailure } from '@/components/feedback';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';
import { SettingsGroup } from '@/components/settings/settings-group';
import { SETTINGS_NODES } from '@/components/settings/settings-capabilities';
import { SettingRow } from '@/components/settings/setting-row';
import { sectionHref } from '@/components/settings/settings-registry';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { api } from '@/lib/api';
import {
  apiQueryOptions,
  queryKeys,
  unwrap,
  useApiListQuery,
  useApiMutation,
  useApiQuery,
} from '@/lib/query';
import { workTemplatesDef } from './work-template-queries';

const KINDS = ['initiative', 'program', 'project', 'task'] as const;

/** Manage definitions, private drafts and retained publications in one workspace. */
export function WorkTemplateSettings({ orgId }: { orgId: string }): JSX.Element {
  const [archived, setArchived] = useState(false);
  const query = useApiListQuery(
    workTemplatesDef(orgId, { includeDrafts: true, includeArchived: archived }),
  );
  return (
    <SettingsSectionPage
      title="Work templates"
      description="Give work a name and a reusable structure. Published templates keep their own history."
      action={<WorkTemplateGuidedCreate orgId={orgId} />}
      loading={query.isPending}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setArchived(!archived);
        }}
      >
        {archived ? 'Hide archived templates' : 'Show archived templates'}
      </Button>
      {query.isError ? (
        <QueryLoadFailure title="Work templates" query={query} />
      ) : (
        KINDS.map((kind) => (
          <TemplateKindRows
            key={kind}
            kind={kind}
            orgId={orgId}
            items={(query.data?.items ?? []).filter((item) => item.targetType === kind)}
          />
        ))
      )}
      <WorkTemplateAuthoringSetting orgId={orgId} />
    </SettingsSectionPage>
  );
}

function TemplateKindRows({
  orgId,
  kind,
  items,
}: {
  orgId: string;
  kind: TemplateTargetType;
  items: readonly WorkTemplateOut[];
}): JSX.Element {
  const noun = useVocabulary(kind, { plural: true });
  return (
    <SettingsGroup title={noun} discoverable={false} body="rows">
      {items.map((item) => (
        <SettingRow
          key={item.id}
          href={`${sectionHref(orgId, 'templates')}/${item.id}`}
          label={item.definition.name}
          description={[
            item.isBase
              ? 'Default'
              : item.scope === 'personal'
                ? 'Only you'
                : item.scope === 'team'
                  ? 'Team'
                  : 'Workspace',
            item.status === 'published'
              ? `Version ${String(item.latestVersion?.number ?? 1)}`
              : item.status === 'archived'
                ? 'Archived'
                : 'Draft',
            item.definition.description,
          ]
            .filter(Boolean)
            .join(' · ')}
        />
      ))}
    </SettingsGroup>
  );
}

/** Only workspace managers may change who can author or publish work templates. */
function WorkTemplateAuthoringSetting({ orgId }: { orgId: string }): JSX.Element {
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
