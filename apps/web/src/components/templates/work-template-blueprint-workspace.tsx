'use client';
import { useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Surface,
} from '@docket/ui/primitives';
import { ChevronDown } from '@docket/ui/icons';
import { InlineBanner } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Blueprint, type BlueprintStep } from '@docket/work/work-template-blueprint';
import type { WorkTemplateFormState } from './use-work-template-form';
import { BlueprintOutline } from './work-template-blueprint-outline';
import { WorkTemplateBlueprintSummary } from './work-template-blueprint-summary';
import { useProgramDefaultScheduleWorkspace } from './program-default-schedule-workspace';
import {
  BlueprintAddChildren,
  BlueprintChildCard,
  type BlueprintEditorProps,
} from './work-template-blueprint-child';

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
    if (!key) return;
    const panel = document.getElementById(`blueprint-child-${key}`);
    const header = document.querySelector<HTMLElement>('[data-template-definition-header]');
    if (panel)
      panel.style.scrollMarginTop =
        header && getComputedStyle(header).position === 'sticky'
          ? `${header.offsetHeight + 24}px`
          : '';
    panel?.scrollIntoView({ block: 'start' });
    panel?.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
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
        requestAnimationFrame(() => {
          const row = rowRefs.get(step.key);
          row?.scrollIntoView({ block: 'center' });
          row?.focus({ preventScroll: true });
        });
      }}
    />
  );
}

interface BlueprintWorkspaceLayoutProps {
  readonly editor: BlueprintEditorProps & { rootKind: WorkTemplateFormState['kind'] };
  readonly selected: BlueprintStep | undefined;
  readonly rowRefs: Map<string, HTMLButtonElement>;
  readonly rootName: string;
  readonly onSelect: (key: string | null) => void;
  readonly form: WorkTemplateFormState;
}
/** Show the included-work overview or one focused child/routine editor at every width. */
export function BlueprintWorkspaceLayout({
  editor,
  selected,
  rowRefs,
  rootName,
  onSelect,
  form,
}: BlueprintWorkspaceLayoutProps): JSX.Element {
  const routines = useProgramDefaultScheduleWorkspace(form, editor, () => {
    onSelect(null);
  });
  const active = Boolean(selected) || routines.active;
  const wasActive = useRef(false);
  useLayoutEffect(() => {
    if (wasActive.current && !active) document.getElementById('template-work-root')?.focus();
    wasActive.current = active;
  }, [active]);
  return (
    <div className="flex min-w-0 flex-col gap-4 p-3 sm:p-0">
      {!Blueprint.safeParse(editor.blueprint).success ? (
        <InlineBanner tone="critical" title="Review child work">
          Name each item, choose what must finish first, and check dates and estimates before
          saving.
        </InlineBanner>
      ) : null}
      <div hidden={active}>
        <IncludedWorkOutline
          editor={editor}
          selected={selected}
          rowRefs={rowRefs}
          rootName={rootName}
          onSelect={(key) => {
            routines.clear();
            onSelect(key);
          }}
          routines={routines.outline}
          onAdd={(kind) => {
            routines.clear();
            editor.onAdd(kind, null);
          }}
        />
      </div>
      {routines.editor}
      <SelectedBlueprintChild
        step={routines.active ? undefined : selected}
        editor={editor}
        rowRefs={rowRefs}
        onClose={() => {
          onSelect(null);
        }}
      />
    </div>
  );
}

function IncludedWorkOutline({
  editor,
  selected,
  rowRefs,
  rootName,
  onSelect,
  onAdd,
  routines,
}: Pick<
  BlueprintWorkspaceLayoutProps,
  'editor' | 'selected' | 'rowRefs' | 'rootName' | 'onSelect'
> & {
  readonly onAdd: (kind: BlueprintStep['kind']) => void;
  readonly routines: ReactNode;
}): JSX.Element {
  return (
    <div id="template-work-outline" className="flex min-w-0 flex-col gap-5">
      <div className="flex min-w-0 flex-col gap-2">
        <h2 id="template-work-root" tabIndex={-1} className="text-title-large outline-none">
          Included work
        </h2>
        <p className="text-body-medium text-on-surface-variant">
          Add the work you want to include. Open an item to edit its details.
        </p>
      </div>
      <CreatedTogether
        editor={editor}
        selected={selected}
        rowRefs={rowRefs}
        rootName={rootName}
        onSelect={onSelect}
        onAdd={onAdd}
      />
      {routines}
    </div>
  );
}

function CreatedTogether({
  editor,
  selected,
  rowRefs,
  rootName,
  onSelect,
  onAdd,
}: Omit<Parameters<typeof IncludedWorkOutline>[0], 'routines'>): JSX.Element {
  const noun = useVocabulary(editor.rootKind).toLocaleLowerCase();
  const [childrenOpen, setChildrenOpen] = useState(true);
  return (
    <Surface
      tone="well"
      shape="medium"
      pad="none"
      className="contents min-w-0 flex-col gap-4 sm:flex sm:p-3"
    >
      <Collapsible open={childrenOpen} onOpenChange={setChildrenOpen} className="min-w-0">
        <div className="flex flex-col gap-1">
          <h3>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="group text-title-medium h-auto w-full justify-between px-0 sm:px-4"
              >
                Created together
                <ChevronDown
                  aria-hidden
                  className="size-5 shrink-0 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
                />
              </Button>
            </CollapsibleTrigger>
          </h3>
          {editor.blueprint.steps.length ? (
            <WorkTemplateBlueprintSummary blueprint={editor.blueprint} />
          ) : (
            <>
              <p className="text-body-medium">No included work yet</p>
              <p className="text-body-small text-on-surface-variant">
                {`A new ${noun} can stand on its own. Add work only when it belongs in every new ${noun}.`}
              </p>
            </>
          )}
        </div>
        <CollapsibleContent className="pt-3">
          <div className="flex min-w-0 flex-col gap-4">
            <BlueprintOutline
              blueprint={editor.blueprint}
              selectedKey={selected?.key ?? null}
              onSelect={onSelect}
              rowRefs={rowRefs}
              rootName={rootName}
              rootKind={editor.rootKind}
              templates={editor.templates}
            />
            <BlueprintAddChildren
              kind={editor.rootKind}
              disabled={editor.disabled || editor.blueprint.steps.length >= 499}
              onAdd={onAdd}
            />
            {editor.blueprint.steps.length >= 450 ? (
              <p className="text-body-small text-on-surface-variant">
                {editor.blueprint.steps.length} of 499 included items. A template can create at most
                500 items, including work added by other templates.
              </p>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Surface>
  );
}
