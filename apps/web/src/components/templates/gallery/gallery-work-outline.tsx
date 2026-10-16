'use client';
import { useState, type JSX } from 'react';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Surface,
} from '@docket/ui/primitives';
import { useVocabulary } from '@docket/ui/hooks';
import type { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { StaticMarkdown } from '@/components/editor/static-markdown';
import { calendarRecurrenceSummary } from '@/components/recurrence/repeat-task-control';
import {
  galleryStructure,
  type GalleryStructureNode,
  type GalleryStructureSource,
} from './gallery-structure';

function WorkNode({ node }: { readonly node: GalleryStructureNode }): JSX.Element {
  const noun = useVocabulary(node.kind === 'milestone' ? 'task' : node.kind);
  const kind = node.kind === 'milestone' ? 'Milestone' : noun;
  return (
    <li className="min-w-0">
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="h-auto min-h-10 w-full justify-start text-left whitespace-normal"
          >
            {node.name}
          </Button>
        </CollapsibleTrigger>
        <p className="text-body-small text-on-surface-variant px-3">
          {kind}
          {node.optional ? ' · Optional' : ''}
          {node.timing ? ` · ${node.timing}` : ''}
        </p>
        <CollapsibleContent className="px-3 py-3">
          <StaticMarkdown value={node.document} />
        </CollapsibleContent>
      </Collapsible>
      {node.children.length ? (
        <ol aria-label={`Included under ${node.name}`} className="ml-3 flex min-w-0 flex-col gap-2">
          <WorkBranch nodes={node.children} />
        </ol>
      ) : null}
    </li>
  );
}
function WorkBranch({ nodes }: { readonly nodes: readonly GalleryStructureNode[] }): JSX.Element {
  return (
    <>
      {nodes.map((node) => (
        <WorkNode key={node.key} node={node} />
      ))}
    </>
  );
}
function RecurringWork({
  definition,
  sources,
}: {
  readonly definition: WorkTemplateDefinition;
  readonly sources: readonly GalleryStructureSource[];
}): JSX.Element | null {
  const program = useVocabulary('program');
  if (!definition.defaultSchedules.length) return null;
  return (
    <section aria-label="Recurring work" className="flex min-w-0 flex-col gap-3">
      <h2 className="text-title-large">Recurring work</h2>
      <p className="text-body-medium text-on-surface-variant">
        These routines begin when you create a {program} from this template. Each {program} gets its
        own editable copies.
      </p>
      <ol className="flex min-w-0 flex-col gap-4">
        {definition.defaultSchedules.map((schedule) => {
          const source = sources.find(
            (entry) => entry.identity.workTypeId === schedule.template.workTypeId,
          );
          return (
            <li key={schedule.key} className="min-w-0">
              <h3 className="text-title-medium break-words">{schedule.name}</h3>
              <p className="text-body-medium">{calendarRecurrenceSummary(schedule.cadence)}</p>
              <p className="text-body-small text-on-surface-variant">
                {source?.definition.name} · Begins{' '}
                {schedule.cadence.startOffsetDays === 0
                  ? `when the ${program} is created`
                  : `${Math.abs(schedule.cadence.startOffsetDays)} days ${schedule.cadence.startOffsetDays < 0 ? 'before' : 'after'} ${program} creation`}
              </p>
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-10 min-w-10 sm:min-h-8 sm:min-w-8"
                  >
                    Routine details for {schedule.name}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <p className="text-body-small break-words">Run title: {schedule.titlePattern}</p>
                  <p className="text-body-small">
                    Responsibility:{' '}
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
    </section>
  );
}
function StartingInstructions({
  definition,
  composed,
}: {
  readonly definition: WorkTemplateDefinition;
  readonly composed: boolean;
}): JSX.Element | null {
  if (!definition.payload.description) return null;
  return (
    <Surface as="section" shape="medium" tone="well" pad="roomy" aria-label="Starting work">
      <h2 className="text-title-medium">Starting work</h2>
      <Collapsible defaultOpen={!composed}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="min-h-10">
            Read starting instructions
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <StaticMarkdown value={definition.payload.description} />
        </CollapsibleContent>
      </Collapsible>
    </Surface>
  );
}
/** Lead with actual included work and routines; disclose supporting instructions on demand. */
export function GalleryWorkOutline({
  definition,
  sources,
}: {
  readonly definition: WorkTemplateDefinition;
  readonly sources: readonly GalleryStructureSource[];
}): JSX.Element {
  const [includedOpen, setIncludedOpen] = useState(true);
  const nodes = galleryStructure(definition, sources);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {nodes.length ? (
        <Collapsible open={includedOpen} onOpenChange={setIncludedOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between">
              Included work
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ol aria-label="Included work" className="flex min-w-0 flex-col gap-3">
              <WorkBranch nodes={nodes} />
            </ol>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      <RecurringWork definition={definition} sources={sources} />
      <StartingInstructions
        definition={definition}
        composed={Boolean(nodes.length || definition.defaultSchedules.length)}
      />
    </div>
  );
}
