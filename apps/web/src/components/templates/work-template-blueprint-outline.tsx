'use client';
import type { JSX } from 'react';
import { ChevronRight } from '@docket/ui/icons';
import { Button, Badge } from '@docket/ui/primitives';
import { useVocabulary } from '@docket/ui/hooks';
import type { Blueprint, BlueprintStep } from '@docket/work/work-template-blueprint';
import type { WorkTemplateFormState } from './use-work-template-form';
import type { BlueprintEditorProps } from './work-template-blueprint-child';
import {
  blueprintOutlineNodes,
  type BlueprintOutlineNode,
  blueprintStepName,
} from './work-template-blueprint-edit';
import { blueprintStepTiming } from './work-template-blueprint-timing';

/** Preserve authored sibling order and semantic parentage in the focused work outline. */
export function BlueprintOutline({
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
    <OutlineBranch
      nodes={blueprintOutlineNodes(blueprint)}
      depth={0}
      label="Child work outline"
      context={{ blueprint, selectedKey, onSelect, rowRefs, rootName, rootKind, templates }}
    />
  );
}
function OutlineBranch({
  nodes,
  depth,
  label,
  context,
}: {
  readonly nodes: readonly BlueprintOutlineNode[];
  readonly depth: number;
  readonly label: string;
  readonly context: Parameters<typeof BlueprintOutline>[0];
}): JSX.Element {
  return (
    <ol
      aria-label={label}
      className={`flex min-w-0 flex-col gap-1 ${depth > 0 && depth <= 3 ? 'pl-3' : ''}`}
    >
      {nodes.map(({ step, children }) => (
        <li key={step.key} className="min-w-0">
          <BlueprintOutlineRow
            step={step}
            blueprint={context.blueprint}
            selected={step.key === context.selectedKey}
            rootName={context.rootName}
            rootKind={context.rootKind}
            templates={context.templates}
            buttonRef={(element) => {
              if (element) context.rowRefs.set(step.key, element);
              else context.rowRefs.delete(step.key);
            }}
            onSelect={() => {
              context.onSelect(step.key);
            }}
          />
          {children.length ? (
            <OutlineBranch
              nodes={children}
              depth={depth + 1}
              label={`Included under ${blueprintStepName(step)}`}
              context={context}
            />
          ) : null}
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
  return (
    <Button
      ref={buttonRef}
      type="button"
      variant={selected ? 'secondary' : 'ghost'}
      aria-label={`Edit ${blueprintStepName(step)}`}
      aria-pressed={selected}
      onClick={onSelect}
      className="coarse:h-auto h-auto min-h-12 w-full scroll-mt-48 justify-start px-0 py-2 text-left sm:px-4"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 break-words whitespace-normal">
        <span className="text-label-large">{blueprintStepName(step)}</span>
        <span className="text-body-small text-on-surface-variant">
          {step.kind === 'milestone' ? 'Milestone' : vocabulary}
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
              'Selected template'}
          </Badge>
        ) : null}
      </span>
      <ChevronRight aria-hidden="true" className="text-on-surface-variant size-4 shrink-0" />
    </Button>
  );
}
