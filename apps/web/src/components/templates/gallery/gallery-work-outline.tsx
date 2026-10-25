'use client';
import type { CopySourceIdentity } from '@docket/work/template-copy';
import { useState, type JSX } from 'react';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Surface,
} from '@docket/ui/primitives';
import { ChevronDown } from '@docket/ui/icons';
import { useVocabulary } from '@docket/ui/hooks';
import type { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { StaticMarkdown } from '@/components/editor/static-markdown';
import { calendarRecurrenceSummary } from '@/components/recurrence/repeat-task-control';
import {
  galleryStructure,
  galleryReferenceSource,
  type GalleryStructureNode,
  type GalleryStructureSource,
} from './gallery-structure';

const INSTRUCTION_TYPOGRAPHY =
  '[&_h1]:text-title-small [&_h2]:text-title-small [&_h3]:text-label-large [&_h1]:mt-3 [&_h2]:mt-3 [&_h3]:mt-2';

function WorkNode({
  node,
  root,
}: {
  readonly node: GalleryStructureNode;
  readonly root: boolean;
}): JSX.Element {
  const noun = useVocabulary(node.kind === 'milestone' ? 'task' : node.kind);
  const kind = node.kind === 'milestone' ? 'Milestone' : noun;
  return (
    <li className="min-w-0">
      <Surface tone={root ? 'card' : 'well'} shape="medium" pad={root ? 'comfortable' : 'none'}>
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="h-auto min-h-10 w-full justify-start px-0 text-left whitespace-normal"
            >
              <span className="text-title-medium min-w-0 flex-1">{node.name}</span>
              <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
          <p className="text-body-small text-on-surface-variant">
            {kind}
            {node.optional ? ' · Optional' : ''}
            {node.timing ? ` · ${node.timing}` : ''}
          </p>
          <CollapsibleContent className="py-2">
            <StaticMarkdown value={node.document} className={INSTRUCTION_TYPOGRAPHY} />
          </CollapsibleContent>
        </Collapsible>
        {node.children.length ? (
          <ol
            aria-label={`Included under ${node.name}`}
            className="ml-3 flex min-w-0 flex-col gap-2"
          >
            <WorkBranch nodes={node.children} root={false} />
          </ol>
        ) : null}
      </Surface>
    </li>
  );
}
function WorkBranch({
  nodes,
  root = true,
}: {
  readonly nodes: readonly GalleryStructureNode[];
  readonly root?: boolean;
}): JSX.Element {
  return (
    <>
      {nodes.map((node) => (
        <WorkNode key={node.key} node={node} root={root} />
      ))}
    </>
  );
}
function RecurringWork({
  definition,
  sources,
  identity,
}: {
  readonly definition: WorkTemplateDefinition;
  readonly sources: readonly GalleryStructureSource[];
  readonly identity?: CopySourceIdentity | undefined;
}): JSX.Element | null {
  const program = useVocabulary('program');
  if (!definition.defaultSchedules.length) return null;
  return (
    <Surface
      as="section"
      tone="well"
      pad="comfortable"
      aria-label="Recurring work"
      className="flex min-w-0 flex-col gap-3"
    >
      <h2 className="text-title-large">Recurring work</h2>
      <p className="text-body-medium text-on-surface-variant">
        These routines begin when you create a {program} from this template. Each {program} gets its
        own editable copies.
      </p>
      <ol className="flex min-w-0 flex-col gap-4">
        {definition.defaultSchedules.map((schedule) => {
          const source = galleryReferenceSource(
            schedule.template,
            sources,
            identity
              ? { owner: identity, slot: { kind: 'default_schedule', key: schedule.key } }
              : undefined,
          );
          return (
            <li key={schedule.key} className="min-w-0">
              <h3 className="text-title-medium break-words">{schedule.name}</h3>
              <p className="text-body-medium">{calendarRecurrenceSummary(schedule.cadence)}</p>
              <p className="text-body-small text-on-surface-variant">
                {source.definition.name} · Begins{' '}
                {schedule.cadence.startOffsetDays === 0
                  ? `when the ${program} is created`
                  : `${Math.abs(schedule.cadence.startOffsetDays)} days ${schedule.cadence.startOffsetDays < 0 ? 'before' : 'after'} ${program} creation`}
              </p>
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-10 min-w-10 px-0 sm:min-h-8 sm:min-w-8"
                  >
                    Routine details for {schedule.name}{' '}
                    <ChevronDown className="size-4" aria-hidden="true" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <p className="text-body-small break-words">
                    New work title: {schedule.titlePattern}
                  </p>
                  <p className="text-body-small">
                    Owner:{' '}
                    {schedule.actorRule === 'parent_responsible'
                      ? `${program} owner`
                      : schedule.actorRule === 'creator'
                        ? `Person creating the ${program}`
                        : schedule.actorRule === 'athena'
                          ? 'Athena'
                          : 'Unassigned'}
                  </p>
                </CollapsibleContent>
              </Collapsible>
            </li>
          );
        })}
      </ol>
    </Surface>
  );
}
function StartingInstructions({
  definition,
}: {
  readonly definition: WorkTemplateDefinition;
}): JSX.Element | null {
  if (!definition.payload.description) return null;
  return (
    <Surface as="section" shape="medium" tone="well" pad="comfortable" aria-label="Starting work">
      <h2 className="text-title-medium">Starting work</h2>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button wrapLabel variant="ghost" className="min-h-10 px-0">
            Read starting instructions <ChevronDown className="size-4" aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <StaticMarkdown
            value={definition.payload.description}
            className={INSTRUCTION_TYPOGRAPHY}
          />
        </CollapsibleContent>
      </Collapsible>
    </Surface>
  );
}
/** Lead with actual included work and routines; disclose supporting instructions on demand. */
export function GalleryWorkOutline({
  definition,
  sources,
  identity,
}: {
  readonly definition: WorkTemplateDefinition;
  readonly sources: readonly GalleryStructureSource[];
  readonly identity?: CopySourceIdentity | undefined;
}): JSX.Element {
  const [includedOpen, setIncludedOpen] = useState(true);
  const nodes = galleryStructure(definition, sources, identity);
  return (
    <div className="flex min-w-0 flex-col gap-3 sm:gap-6">
      {nodes.length ? (
        <Collapsible open={includedOpen} onOpenChange={setIncludedOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between px-3 sm:px-0">
              Included work <ChevronDown className="size-4" aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ol aria-label="Included work" className="flex min-w-0 flex-col gap-3">
              <WorkBranch nodes={nodes} />
            </ol>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      <RecurringWork definition={definition} sources={sources} identity={identity} />
      <StartingInstructions definition={definition} />
    </div>
  );
}
