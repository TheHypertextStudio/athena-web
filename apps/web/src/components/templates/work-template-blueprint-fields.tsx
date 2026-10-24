'use client';
import { useRef, type JSX } from 'react';
import { useTemplateEditorSelection } from './template-editor-selection';
import { useVocabulary } from '@docket/ui/hooks';
import type { Blueprint, BlueprintStep } from '@docket/work/work-template-blueprint';
import { useApiQuery } from '@/lib/query';
import { QueryLoadFailure } from '@/components/feedback';
import type { WorkTemplateFormState } from './use-work-template-form';
import { workTemplatesDef } from './work-template-queries';
import { BlueprintWorkspaceLayout } from './work-template-blueprint-workspace';
import { addBlueprintChild } from './work-template-blueprint-edit';
import { type BlueprintEditorProps } from './work-template-blueprint-child';

/** Author the reusable child graph in the existing canonical template draft. */
export function WorkTemplateBlueprintFields({
  orgId,
  form,
}: {
  orgId: string;
  form: WorkTemplateFormState;
}): JSX.Element {
  const childNouns = useBlueprintChildNouns();
  const query = useApiQuery(workTemplatesDef(orgId, { includeDrafts: true }));
  const [selectedKey, setSelectedKey] = useTemplateEditorSelection('child');
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const blueprint = form.definition.blueprint;
  const disabled = form.pending || !form.canEdit;
  const change = (next: Blueprint): void => {
    form.setDefinition((value) => ({ ...value, blueprint: next }));
  };
  const add = (kind: BlueprintStep['kind'], parent: string | null): void => {
    const next = addBlueprintChild(
      blueprint,
      kind,
      parent,
      `New ${childNouns[kind].toLocaleLowerCase()}`,
    );
    change(next);
    const key = next.steps.at(-1)?.key;
    if (key) setSelectedKey(key);
  };
  const props: BlueprintEditorProps & { rootKind: WorkTemplateFormState['kind'] } = {
    orgId,
    blueprint,
    rootKind: form.kind,
    templates: query.data?.items ?? [],
    disabled,
    onChange: change,
    onAdd: add,
  };
  const selected = blueprint.steps.find((step) => step.key === selectedKey);
  return (
    <section
      className="flex min-w-0 scroll-mt-48 flex-col gap-4"
      aria-label="Template children"
      id="template-children"
      tabIndex={-1}
    >
      {query.isError ? <QueryLoadFailure title="Start from templates" query={query} /> : null}
      <BlueprintWorkspaceLayout
        editor={props}
        selected={selected}
        rowRefs={rowRefs.current}
        rootName={form.definition.name.trim() ? form.definition.name : 'Untitled work'}
        onSelect={setSelectedKey}
        form={form}
      />
    </section>
  );
}

function useBlueprintChildNouns(): Readonly<Record<BlueprintStep['kind'], string>> {
  return {
    task: useVocabulary('task'),
    project: useVocabulary('project'),
    program: useVocabulary('program'),
    milestone: 'Milestone',
  };
}
