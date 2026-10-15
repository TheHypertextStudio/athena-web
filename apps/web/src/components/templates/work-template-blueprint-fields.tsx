'use client';
import { useLayoutEffect, useRef, useState, type JSX } from 'react';
import { Button, Badge, Surface } from '@docket/ui/primitives';
import { InlineBanner } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Blueprint, type BlueprintStep } from '@docket/work/work-template-blueprint';
import { useApiQuery } from '@/lib/query';
import { QueryLoadFailure } from '@/components/feedback';
import type { WorkTemplateFormState } from './use-work-template-form';
import { workTemplatesDef } from './work-template-queries';
import { addBlueprintChild, orderedBlueprintChildren } from './work-template-blueprint-edit';
import { blueprintStepName } from './work-template-blueprint-edit';
import { blueprintStepTiming } from './work-template-blueprint-timing';
import { WorkTemplateBlueprintSummary } from './work-template-blueprint-summary';
import {
  BlueprintAddChildren,
  BlueprintChildCard,
  type BlueprintEditorProps,
} from './work-template-blueprint-child';

/** Author the reusable child graph in the existing canonical template draft. */
export function WorkTemplateBlueprintFields({
  orgId,
  form,
}: {
  orgId: string;
  form: WorkTemplateFormState;
}): JSX.Element {
  const childNouns = useBlueprintChildNouns();
  const query = useApiQuery(workTemplatesDef(orgId));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
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
  const props: BlueprintEditorProps = {
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
    <Surface
      as="section"
      tone="card"
      shape="extra-large"
      pad="roomy"
      className="flex min-w-0 scroll-mt-48 flex-col gap-4 sm:p-6"
      aria-label="Template children"
      id="template-children"
      tabIndex={-1}
    >
      <BlueprintIntro blueprint={blueprint} />
      {query.isError ? <QueryLoadFailure title="Nested templates" query={query} /> : null}
      <BlueprintOutline
        blueprint={blueprint}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        rowRefs={rowRefs.current}
        rootName={form.definition.name.trim() ? form.definition.name : 'parent'}
        rootKind={form.kind}
        templates={props.templates}
      />
      <BlueprintAddChildren
        kind={form.kind}
        disabled={disabled || blueprint.steps.length >= 499}
        onAdd={(kind) => {
          add(kind, null);
        }}
      />
      <BlueprintLimit blueprint={blueprint} />
      <SelectedBlueprintChild
        step={selected}
        editor={props}
        rowRefs={rowRefs.current}
        onClose={() => {
          setSelectedKey(null);
        }}
      />
    </Surface>
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

function SelectedBlueprintChild({
  step,
  editor,
  rowRefs,
  onClose,
}: {
  step: BlueprintStep | undefined;
  editor: BlueprintEditorProps;
  rowRefs: Map<string, HTMLButtonElement>;
  onClose: () => void;
}): JSX.Element | null {
  const key = step?.key;
  useLayoutEffect(() => {
    if (key) document.getElementById(`blueprint-child-${key}`)?.scrollIntoView({ block: 'start' });
  }, [key]);
  if (!step) return null;
  return (
    <BlueprintChildCard
      key={step.key}
      {...editor}
      step={step}
      open
      onOpenChange={() => {
        onClose();
        const row = rowRefs.get(step.key);
        row?.scrollIntoView({ block: 'center' });
        row?.focus({ preventScroll: true });
      }}
    />
  );
}

function BlueprintIntro({ blueprint }: { blueprint: Blueprint }): JSX.Element {
  const tasks = useVocabulary('task', { plural: true });
  return (
    <>
      <div className="flex flex-col gap-2">
        <h3 className="text-title-large">Child work</h3>
        <p className="text-body-small text-on-surface-variant">
          Created with this item. Dates follow the parent, a Milestone, or completed sibling {tasks}
          .
        </p>
        <WorkTemplateBlueprintSummary blueprint={blueprint} />
      </div>
      {!Blueprint.safeParse(blueprint).success ? (
        <InlineBanner tone="critical" title="Review child work">
          Name every child, choose completion prerequisites, and keep offsets and estimates within
          their limits before saving.
        </InlineBanner>
      ) : null}
    </>
  );
}

function BlueprintLimit({ blueprint }: { blueprint: Blueprint }): JSX.Element {
  return (
    <>
      {blueprint.steps.length >= 450 ? (
        <p className="text-body-small text-on-surface-variant">
          {blueprint.steps.length} of 499 authored children. Publication checks nested templates
          against the 500-item limit.
        </p>
      ) : null}
    </>
  );
}

function BlueprintOutline({
  blueprint,
  selectedKey,
  onSelect,
  rowRefs,
  rootName,
  rootKind,
  templates,
}: {
  blueprint: Blueprint;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  rowRefs: Map<string, HTMLButtonElement>;
  rootName: string;
  rootKind: WorkTemplateFormState['kind'];
  templates: BlueprintEditorProps['templates'];
}): JSX.Element {
  return (
    <ol aria-label="Child work outline" className="flex min-w-0 flex-col gap-1">
      {orderedBlueprintChildren(blueprint).map((step) => (
        <li key={step.key} className="min-w-0">
          <BlueprintOutlineRow
            step={step}
            blueprint={blueprint}
            selected={step.key === selectedKey}
            rootName={rootName}
            rootKind={rootKind}
            templates={templates}
            buttonRef={(element) => {
              if (element) rowRefs.set(step.key, element);
              else rowRefs.delete(step.key);
            }}
            onSelect={() => {
              onSelect(step.key);
            }}
          />
        </li>
      ))}
    </ol>
  );
}

function BlueprintOutlineRow({
  step,
  blueprint,
  selected,
  onSelect,
  buttonRef,
  rootName,
  rootKind,
  templates,
}: {
  step: BlueprintStep;
  blueprint: Blueprint;
  selected: boolean;
  onSelect: () => void;
  buttonRef: (element: HTMLButtonElement | null) => void;
  rootName: string;
  rootKind: WorkTemplateFormState['kind'];
  templates: BlueprintEditorProps['templates'];
}): JSX.Element {
  const vocabulary = useVocabulary(step.kind === 'milestone' ? 'task' : step.kind);
  const parent = blueprint.steps.find((value) => value.key === step.parentStepKey);
  return (
    <Button
      ref={buttonRef}
      type="button"
      variant={selected ? 'secondary' : 'ghost'}
      aria-label={`Edit ${blueprintStepName(step)}`}
      aria-pressed={selected}
      onClick={onSelect}
      className="coarse:h-auto h-auto min-h-12 w-full scroll-mt-48 justify-start py-2 text-left"
    >
      <span className="flex min-w-0 flex-col gap-0.5 break-words whitespace-normal">
        <span className="text-label-large">
          {parent ? '↳ ' : ''}
          {blueprintStepName(step)}
        </span>
        <span className="text-body-small text-on-surface-variant">
          {step.kind === 'milestone' ? 'Milestone' : vocabulary}
          {parent ? ` · Under ${blueprintStepName(parent)}` : ''}
          {step.optional.enabled
            ? ` · Optional${step.optional.selectedByDefault ? '' : ' (unchecked)'}`
            : ''}
        </span>
        <span className="text-body-small text-on-surface-variant">
          {blueprintStepTiming(step, blueprint, rootName, rootKind)}
        </span>
        {step.template ? (
          <Badge variant="outline" className="self-start">
            {templates.find((value) => value.id === step.template?.workTypeId)?.definition.name ??
              'Nested template'}
          </Badge>
        ) : null}
      </span>
    </Button>
  );
}
