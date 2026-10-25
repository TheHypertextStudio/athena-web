'use client';
import { useState, type JSX } from 'react';
import { Button } from '@docket/ui/primitives';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import { WorkTemplateBlueprintSummary } from './work-template-blueprint-summary';
import { TemplateDisclosure } from './template-disclosure';
import { LabelConversionEntry } from './label-conversion/entry';
import { TemplateCopyAction } from './source-copy/template-copy-action';
import { WorkTemplateArchiveAction } from './work-template-archive-action';
import { QueryLoadFailure } from '@/components/feedback';
import { StaticMarkdown } from '@/components/editor/static-markdown';
import { useApiQuery } from '@/lib/query';
import { workTemplateVersionsDef } from './work-template-queries';
import type { WorkTemplateFormState } from './use-work-template-form';

/** Read immutable publication snapshots without replacing the current draft. */
export function TemplatePublishedHistory({
  orgId,
  id,
  template,
  visible,
}: {
  orgId: string;
  id: string | null;
  template: WorkTemplateOut | undefined;
  visible: boolean;
}): JSX.Element | null {
  if (!visible || id === null || !template?.latestVersion) return null;
  return <TemplateHistory orgId={orgId} id={id} template={template} />;
}

function TemplateHistory({
  orgId,
  id,
  template,
}: {
  orgId: string;
  id: string;
  template: WorkTemplateOut;
}): JSX.Element {
  const query = useApiQuery(workTemplateVersionsDef(orgId, id));
  const [selected, setSelected] = useState<string | null>(null);
  const version = query.data?.items.find((item) => item.id === selected);
  return (
    <TemplateDisclosure title="Published history">
      <p className="text-body-small text-on-surface-variant">
        These snapshots stay unchanged when the next draft is edited.
      </p>
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
          <WorkTemplateBlueprintSummary blueprint={version.definition.blueprint} />
          <TemplateCopyAction template={template} version={version} />
          <LabelConversionEntry template={template} version={version} />
        </div>
      ) : null}
    </TemplateDisclosure>
  );
}

/** Keep archival separate from the publication decision. */
export function TemplatePublicationActions({
  orgId,
  initial,
  form,
}: {
  orgId: string;
  initial: WorkTemplateOut;
  form: WorkTemplateFormState;
}): JSX.Element | null {
  if (initial.isBase || initial.status === 'archived') return null;
  return (
    <TemplateDisclosure title="Manage template">
      <TemplateCopyAction template={initial} />
      <LabelConversionEntry template={initial} />
      {form.canEdit ? <WorkTemplateArchiveAction orgId={orgId} id={initial.id} /> : null}
    </TemplateDisclosure>
  );
}
