'use client';
import type { JSX } from 'react';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Field,
  Select,
} from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import { WorkTemplateLibrary } from './gallery/work-template-library';
import { QueryLoadFailure } from '@/components/feedback';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';
import { SettingsGroup } from '@/components/settings/settings-group';
import { SETTINGS_NODES } from '@/components/settings/settings-capabilities';
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

/** Manage definitions, private drafts and retained publications in one workspace. */
export function WorkTemplateSettings({ orgId }: { orgId: string }): JSX.Element {
  const query = useApiListQuery(
    workTemplatesDef(orgId, { includeDrafts: true, includeArchived: true }),
  );
  return (
    <SettingsSectionPage
      headingSize="expressive"
      title="Work templates"
      description="Give work a name and a reusable structure. Published templates keep their own history."
      action={
        <div className="flex flex-wrap gap-2">
          <Button asChild className="min-h-10">
            <Link href={`${sectionHref(orgId, 'templates')}/gallery`}>Choose starting work</Link>
          </Button>
          <Button asChild variant="secondary" className="min-h-10">
            <Link href={`${sectionHref(orgId, 'templates')}/new`}>Define work</Link>
          </Button>
        </div>
      }
      loading={query.isPending}
    >
      {query.isError ? (
        <QueryLoadFailure title="Work templates" query={query} />
      ) : (
        <WorkTemplateLibrary orgId={orgId} items={query.data?.items ?? []} />
      )}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="min-h-10">
            Template permissions
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <WorkTemplateAuthoringSetting orgId={orgId} />
        </CollapsibleContent>
      </Collapsible>
    </SettingsSectionPage>
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
