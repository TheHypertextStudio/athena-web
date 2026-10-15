'use client';
import { useLayoutEffect, useState, type JSX, type ReactNode } from 'react';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Separator,
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
        requestAnimationFrame(() => {
          const row = rowRefs.get(step.key);
          row?.scrollIntoView({ block: 'center' });
          row?.focus({ preventScroll: true });
        });
      }}
    />
  );
}

function BlueprintIntro({ blueprint }: { blueprint: Blueprint }): JSX.Element {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h2 tabIndex={-1} className="text-title-large">
          Work outline
        </h2>
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

interface BlueprintWorkspaceLayoutProps {
  readonly rootEditor: ReactNode;
  readonly editor: BlueprintEditorProps & { rootKind: WorkTemplateFormState['kind'] };
  readonly selected: BlueprintStep | undefined;
  readonly rowRefs: Map<string, HTMLButtonElement>;
  readonly rootName: string;
  readonly onSelect: (key: string | null) => void;
  readonly form: WorkTemplateFormState;
}
/** One ordered work outline and a focused parent, child or routine editor. */
export function BlueprintWorkspaceLayout({
  rootEditor,
  editor,
  selected,
  rowRefs,
  rootName,
  onSelect,
  form,
}: BlueprintWorkspaceLayoutProps): JSX.Element {
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [childrenOpen, setChildrenOpen] = useState(true);
  const routines = useProgramDefaultScheduleWorkspace(
    form,
    editor,
    () => {
      onSelect(null);
      setOutlineOpen(false);
    },
    () => {
      setOutlineOpen(true);
    },
  );
  const select = (key: string | null): void => {
    routines.clear();
    onSelect(key);
    setOutlineOpen(false);
    if (key === null) focusStartingWork();
  };
  return (
    <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(14rem,.8fr)_minmax(0,1.4fr)]">
      <IncludedWorkOutline
        editor={editor}
        selected={selected}
        rowRefs={rowRefs}
        rootName={rootName}
        outlineOpen={outlineOpen}
        childrenOpen={childrenOpen}
        onChildrenOpen={setChildrenOpen}
        rootSelected={!selected && !routines.active}
        onSelect={select}
        routines={routines.outline}
        onAdd={(kind) => {
          routines.clear();
          editor.onAdd(kind, null);
          setChildrenOpen(true);
          setOutlineOpen(false);
        }}
      />
      <div className={`${outlineOpen ? 'hidden xl:flex' : 'flex'} min-w-0 flex-col gap-3`}>
        {!selected && !routines.active ? (
          <RootOutlineReturn
            outlineOpen={outlineOpen}
            onReturn={() => {
              setOutlineOpen((current) => !current);
              focusOutlineRoot();
            }}
          />
        ) : null}
        {routines.editor}
        <div hidden={Boolean(selected) || routines.active} className="min-w-0">
          {rootEditor}
        </div>
        <SelectedBlueprintChild
          step={routines.active ? undefined : selected}
          editor={editor}
          rowRefs={rowRefs}
          onClose={() => {
            onSelect(null);
            setChildrenOpen(true);
            setOutlineOpen(true);
          }}
        />
      </div>
    </div>
  );
}

function IncludedWorkOutline({
  editor,
  selected,
  rowRefs,
  rootName,
  outlineOpen,
  childrenOpen,
  onChildrenOpen,
  rootSelected,
  onSelect,
  onAdd,
  routines,
}: Pick<
  BlueprintWorkspaceLayoutProps,
  'editor' | 'selected' | 'rowRefs' | 'rootName' | 'onSelect'
> & {
  readonly outlineOpen: boolean;
  readonly childrenOpen: boolean;
  readonly onChildrenOpen: (open: boolean) => void;
  readonly rootSelected: boolean;
  readonly onAdd: (kind: BlueprintStep['kind']) => void;
  readonly routines: ReactNode;
}): JSX.Element {
  useLayoutEffect(() => {
    const header = document.querySelector<HTMLElement>('[data-template-definition-header]');
    const outline = document.getElementById('template-work-outline');
    if (!header || !outline) return;
    const update = (): void => {
      outline.style.setProperty('--work-outline-top', `${header.offsetHeight + 24}px`);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => {
      observer.disconnect();
    };
  }, []);
  return (
    <Surface
      id="template-work-outline"
      tone="well"
      shape="medium"
      pad="comfortable"
      className={`${outlineOpen ? 'flex' : 'hidden xl:flex'} min-w-0 flex-col gap-3 xl:sticky xl:top-[var(--work-outline-top)]`}
    >
      <BlueprintIntro blueprint={editor.blueprint} />
      <BlueprintWorkRootRow
        rootName={rootName}
        rootKind={editor.rootKind}
        selected={rootSelected}
        onSelect={() => {
          onSelect(null);
        }}
      />
      <IncludedWorkBranch
        editor={editor}
        childrenOpen={childrenOpen}
        onChildrenOpen={onChildrenOpen}
        selected={selected}
        rowRefs={rowRefs}
        rootName={rootName}
        onSelect={onSelect}
        onAdd={onAdd}
      />
      {routines ? (
        <>
          <Separator className="my-1" />
          {routines}
        </>
      ) : null}
    </Surface>
  );
}
function RootOutlineReturn({
  outlineOpen,
  onReturn,
}: {
  readonly outlineOpen: boolean;
  readonly onReturn: () => void;
}): JSX.Element {
  return (
    <Button type="button" variant="ghost" className="self-start xl:hidden" onClick={onReturn}>
      {outlineOpen ? 'Focus selected work' : 'Back to outline'}
    </Button>
  );
}
function BlueprintWorkRootRow({
  rootName,
  rootKind,
  selected,
  onSelect,
}: {
  readonly rootName: string;
  readonly rootKind: WorkTemplateFormState['kind'];
  readonly selected: boolean;
  readonly onSelect: () => void;
}): JSX.Element {
  const noun = useVocabulary(rootKind);
  return (
    <Button
      type="button"
      variant={selected ? 'secondary' : 'ghost'}
      className="h-auto min-h-12 w-full justify-start py-3 text-left"
      id="template-work-root"
      aria-label={`Edit parent ${rootName}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="flex min-w-0 flex-col gap-1 whitespace-normal">
        <span className="text-title-medium break-words">{rootName}</span>
        <span className="text-body-small text-on-surface-variant">{noun} · Parent work</span>
      </span>
    </Button>
  );
}

function focusStartingWork(): void {
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('#template-outline h2')?.focus({ preventScroll: true });
  });
}
function focusOutlineRoot(): void {
  requestAnimationFrame(() => {
    document.getElementById('template-work-root')?.focus({ preventScroll: true });
  });
}

function IncludedWorkBranch({
  editor,
  childrenOpen,
  onChildrenOpen,
  selected,
  rowRefs,
  rootName,
  onSelect,
  onAdd,
}: Pick<
  Parameters<typeof IncludedWorkOutline>[0],
  | 'editor'
  | 'childrenOpen'
  | 'onChildrenOpen'
  | 'selected'
  | 'rowRefs'
  | 'rootName'
  | 'onSelect'
  | 'onAdd'
>): JSX.Element {
  return (
    <Collapsible open={childrenOpen} onOpenChange={onChildrenOpen} className="min-w-0">
      <div className="flex flex-col gap-1">
        <h3>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="group text-title-medium h-auto w-full justify-between"
            >
              <span>Included work</span>
              <ChevronDown
                aria-hidden
                className="size-5 shrink-0 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
              />
            </Button>
          </CollapsibleTrigger>
        </h3>
        <WorkTemplateBlueprintSummary blueprint={editor.blueprint} />
      </div>
      <CollapsibleContent>
        <div className="flex min-w-0 flex-col gap-3 pt-3">
          <BlueprintOutline
            blueprint={editor.blueprint}
            selectedKey={selected?.key ?? null}
            onSelect={(key) => {
              onSelect(key);
            }}
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
          <BlueprintLimit blueprint={editor.blueprint} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
