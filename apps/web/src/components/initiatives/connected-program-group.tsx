'use client';

/**
 * One Program in the Initiative's connected-work tree, and the Projects it holds.
 *
 * @remarks
 * The Program is a container, so it is drawn as one and behaves as one: a header you can collapse,
 * and contents that are their own list. Its heading is an {@link ObjectGroupHeader} rather than a
 * bolder list row, because a heading and an item are different things — rendering both from one
 * component is what produced a Program and its Projects at identical size, with nothing on screen
 * saying which contained the other.
 *
 * The field that adds work is the last item of the Program's own list, so what it creates lands
 * where it was typed. Nothing floats above the tree.
 */
import type { EntityDisplayOut } from '@docket/work/entity-display-contract';
import type { InitiativeConnectedWork } from '@docket/work/initiative-contract';
import { Collapsible, CollapsibleContent, Surface } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { AddOrLinkRow, type AddOrLinkGroup } from '@/components/initiatives/add-or-link-row';
import { ConnectedProjectRow } from '@/components/initiatives/connected-project-row';
import { DisclosureToggle } from '@/components/initiatives/disclosure-toggle';
import { EntityIconGlyph } from '@/components/entity-display/entity-icon-glyph';
import type { ConnectedWorkDisplayLookup } from '@/components/initiatives/use-connected-work-displays';
import { ObjectGroupHeader } from '@/components/objects/object-group-header';

/** Props for {@link ConnectedProgramGroup}. */
export interface ConnectedProgramGroupProps {
  readonly program: InitiativeConnectedWork;
  readonly projects: readonly InitiativeConnectedWork[];
  readonly routeOrganizationId: string;
  readonly initiativeId: string;
  readonly projectNoun: string;
  /** Whether the viewer may add work to this Program. */
  readonly canEdit: boolean;
  /** Candidate sources for the field at the foot of this Program's list. */
  readonly addGroups: readonly AddOrLinkGroup[];
  /** Whether those candidate lists are still arriving. */
  readonly optionsLoading: boolean;
  /** Create a Project inside this Program. */
  readonly onCreate: (name: string) => Promise<void>;
  /** Build the object's own overflow menu for one row. */
  readonly renderMenu: (name: string) => JSX.Element | null;
  /** Resolve one row's customized icon. */
  readonly displayFor: ConnectedWorkDisplayLookup;
}

/** Props for the private {@link ProgramHeading}. */
interface ProgramHeadingProps {
  readonly program: InitiativeConnectedWork;
  readonly routeOrganizationId: string;
  readonly initiativeId: string;
  readonly display: EntityDisplayOut;
  readonly count: string | null;
  /** The object's own menu, which must live inside the object's surface to find its subject. */
  readonly menu: JSX.Element | null;
}

/** The Program itself, drawn as the heading of what it holds. */
function ProgramHeading({
  program,
  routeOrganizationId,
  initiativeId,
  display,
  count,
  menu,
}: ProgramHeadingProps): JSX.Element {
  const crossWorkspace = program.organizationId !== routeOrganizationId;

  return (
    <ObjectGroupHeader
      object={{
        kind: 'program',
        id: program.id,
        organizationId: program.organizationId,
        title: program.name,
        meta: { initiativeId, directLink: program.direct },
      }}
      href={`/orgs/${program.organizationId}/programs/${program.id}`}
      icon={
        <EntityIconGlyph
          subjectType={display.subjectType}
          glyph={display.glyph}
          colorKey={display.colorKey}
          customColor={display.customColor}
          size={32}
        />
      }
      {...(count === null ? {} : { count })}
      trailing={menu}
      dragDisabled={crossWorkspace}
      actionScope={crossWorkspace ? 'reference' : 'all'}
      surfaceId="initiative-connected-work"
      className="min-w-0 flex-1 px-0"
    />
  );
}

/** A collapsible Program container. */
export function ConnectedProgramGroup({
  program,
  projects,
  routeOrganizationId,
  initiativeId,
  projectNoun,
  canEdit,
  addGroups,
  optionsLoading,
  onCreate,
  renderMenu,
  displayFor,
}: ConnectedProgramGroupProps): JSX.Element {
  const [open, setOpen] = useState(true);
  const noun = projectNoun.toLowerCase();

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <Surface tone="canvas" pad="tight" className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1">
          <DisclosureToggle open={open} label={program.name} />
          <ProgramHeading
            program={program}
            routeOrganizationId={routeOrganizationId}
            initiativeId={initiativeId}
            display={displayFor('program', program.id)}
            count={
              projects.length > 0
                ? `${String(projects.length)} ${projects.length === 1 ? noun : `${noun}s`}`
                : null
            }
            menu={renderMenu(program.name)}
          />
        </div>
        <CollapsibleContent>
          <div className="flex min-w-0 flex-col gap-1 pl-6">
            {projects.map((project) => (
              <ConnectedProjectRow
                key={project.id}
                item={project}
                routeOrganizationId={routeOrganizationId}
                initiativeId={initiativeId}
                menu={renderMenu(project.name)}
                display={displayFor('project', project.id)}
                // A step up from the Program's own surface, so a Project inside it reads as a
                // container within a container rather than as loose content on the Program's fill.
              />
            ))}
            <div>
              <AddOrLinkRow
                canEdit={canEdit}
                noun={noun}
                placeholder={`Add to ${program.name}…`}
                onCreate={onCreate}
                groups={addGroups}
                loading={optionsLoading}
              />
            </div>
          </div>
        </CollapsibleContent>
      </Surface>
    </Collapsible>
  );
}
