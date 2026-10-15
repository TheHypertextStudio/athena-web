'use client';
import { useState, type JSX } from 'react';
import { Button } from '@docket/ui/primitives';
import { InlineBanner, ConfirmDestructiveDialog } from '@docket/ui/components';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';
import { SettingsGroup } from '@/components/settings/settings-group';
import { sectionHref } from '@/components/settings/settings-registry';
import { QueryLoadFailure } from '@/components/feedback';
import { StaticMarkdown } from '@/components/editor/static-markdown';
import { useApiQuery } from '@/lib/query';
import { useAppRouter } from '@/lib/interactions/navigation';
import { type WorkTemplateFormState, useWorkTemplateForm } from './use-work-template-form';
import { WorkTemplateFields } from './work-template-fields';
import {
  workTemplateDef,
  workTemplateVersionsDef,
  useWorkTemplateWrites,
} from './work-template-queries';

/** Routed editor for an editable draft and the template's immutable publication history. */
export function WorkTemplateAuthoring({
  orgId,
  id,
}: {
  orgId: string;
  id: string | null;
}): JSX.Element {
  const query = useApiQuery({ ...workTemplateDef(orgId, id ?? ''), enabled: id !== null });
  const router = useAppRouter();
  const href = sectionHref(orgId, 'templates');
  return (
    <SettingsSectionPage
      title={query.data?.definition.name ?? 'New template'}
      description="Save a draft, then publish the version people can use for new work."
      parent={{ label: 'Work templates', href }}
      loading={id !== null && query.isPending}
    >
      {query.isError && id !== null ? (
        <QueryLoadFailure title="Template" query={query} />
      ) : (
        <WorkTemplateForm
          key={id ?? 'new'}
          orgId={orgId}
          initial={query.data ?? null}
          onCreated={(createdId) => router.replace(`${href}/${createdId}`)}
        />
      )}
      {id !== null && query.data?.latestVersion ? <TemplateHistory orgId={orgId} id={id} /> : null}
    </SettingsSectionPage>
  );
}

/** Failed writes preserve the editable draft; publication is a separate explicit action. */
export function WorkTemplateForm({
  orgId,
  initial,
  onCreated,
}: {
  orgId: string;
  initial: WorkTemplateOut | null;
  onCreated: (id: string) => void;
}): JSX.Element {
  const form = useWorkTemplateForm(orgId, initial, onCreated);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <SettingsGroup
        title={initial?.status === 'published' ? 'Next version' : 'Draft'}
        discoverable={false}
        description={
          !form.canEdit
            ? 'You can read this template. Its authoring permissions do not allow edits.'
            : initial?.isBase
              ? 'The blank template remains available for every item of this kind. Its name follows workspace terminology.'
              : undefined
        }
      >
        <WorkTemplateFields
          orgId={orgId}
          form={form}
          existing={initial !== null}
          isBase={initial?.isBase ?? false}
        />
        <TemplateSaveActions form={form} />
      </SettingsGroup>
      {initial ? <TemplatePublicationActions orgId={orgId} initial={initial} form={form} /> : null}
    </div>
  );
}

function TemplateHistory({ orgId, id }: { orgId: string; id: string }): JSX.Element {
  const query = useApiQuery(workTemplateVersionsDef(orgId, id));
  const [selected, setSelected] = useState<string | null>(null);
  const version = query.data?.items.find((item) => item.id === selected);
  return (
    <SettingsGroup
      capability={{
        id: 'template-history',
        label: 'Published history',
        description: 'These snapshots stay unchanged when the next draft is edited.',
        sectionKey: 'templates',
        scope: 'workspace',
        nestedPath: `templates/${id}`,
      }}
    >
      {query.isError ? (
        <QueryLoadFailure title="Template history" query={query} />
      ) : (
        <div className="flex flex-wrap gap-2">
          {(query.data?.items ?? []).map((item) => (
            <Button
              key={item.id}
              type="button"
              variant="secondary"
              onClick={() => {
                setSelected(item.id);
              }}
            >
              Version {item.number}
            </Button>
          ))}
        </div>
      )}
      {version ? (
        <div className="min-w-0">
          <h3 className="text-title-medium break-words">{version.definition.name}</h3>
          <StaticMarkdown value={version.definition.payload.description ?? ''} />
        </div>
      ) : null}
    </SettingsGroup>
  );
}

function TemplateSaveActions({ form }: { form: WorkTemplateFormState }): JSX.Element {
  return (
    <>
      {form.error ? (
        <InlineBanner tone="critical" title="Template could not be saved">
          {form.error}
        </InlineBanner>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={!form.canEdit || form.pending || !form.definition.name.trim() || !form.dirty}
          onClick={() => {
            void form.save();
          }}
        >
          Save draft
        </Button>
        <span role="status" className="text-body-small text-on-surface-variant">
          {form.pending ? 'Saving…' : form.dirty ? 'Unsaved changes' : form.saved ? 'Saved' : ''}
        </span>
      </div>
    </>
  );
}

function TemplatePublicationActions({
  orgId,
  initial,
  form,
}: {
  orgId: string;
  initial: WorkTemplateOut;
  form: WorkTemplateFormState;
}): JSX.Element {
  const writes = useWorkTemplateWrites(orgId);
  const [archiveOpen, setArchiveOpen] = useState(false);
  return (
    <>
      {initial.status !== 'archived' ? (
        <SettingsGroup
          capability={{
            id: 'template-publication',
            label: 'Publication',
            description:
              'Publishing shares this document with everyone in the workspace. Team offerings control where it is suggested. Existing work keeps its saved version and content.',
            sectionKey: 'templates',
            scope: 'workspace',
            nestedPath: `templates/${initial.id}`,
          }}
        >
          <Button
            type="button"
            disabled={!form.canEdit || form.pending || form.dirty}
            onClick={() => {
              void form.publish();
            }}
          >
            {initial.status === 'published' ? 'Publish next version' : 'Publish to workspace'}
          </Button>
        </SettingsGroup>
      ) : null}
      {!initial.isBase && initial.status !== 'archived' && form.canEdit ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setArchiveOpen(true);
          }}
        >
          Archive template
        </Button>
      ) : null}
      <ConfirmDestructiveDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive this template?"
        description="It will stop appearing for new work. Existing work and every published version remain available."
        confirmLabel="Archive template"
        pending={writes.archive.isPending}
        onConfirm={() => {
          writes.archive.mutate(initial.id, {
            onSuccess: () => {
              setArchiveOpen(false);
            },
          });
        }}
      />
    </>
  );
}
