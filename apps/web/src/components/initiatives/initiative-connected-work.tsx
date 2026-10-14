'use client';

/**
 * The Initiative's Connected work panel — the Projects advancing it, inside the Programs that hold
 * them, with the controls to create, link, and unlink.
 *
 * @remarks
 * A Program is drawn as the container it is: its own surface, with its Projects inside it and the
 * quick-add that files new ones into it. It is not a sibling row. That distinction is the whole
 * point of the tab — the first version listed Programs and Projects as peers, which said the
 * opposite of what the data means.
 *
 * Grouping is presentation only. `initiative_program` and `initiative_project` are independent
 * associations: linking a Program does not link its Projects, so a Project appears here because
 * someone linked it, and the Program around it says where it lives. Quick-adding inside a Program
 * writes both edges at once.
 *
 * Every row states what it is through its icon and what it is called, never the word "Project" —
 * a list of Projects does not need to say so on each line. What it does say is the summary someone
 * wrote, the workspace's own name for the status, and health only when health is worth acting on.
 */
import type { InitiativeConnectedWork } from '@docket/work/initiative-contract';
import type { PickerOption } from '@docket/ui/components';
import { Ellipsis } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { useObjectContextMenu } from '@/components/context-menu';
import { AddOrLinkRow, type AddOrLinkGroup } from '@/components/initiatives/add-or-link-row';
import { ConnectedProgramGroup } from '@/components/initiatives/connected-program-group';
import { ConnectedProjectRow } from '@/components/initiatives/connected-project-row';
import {
  type ConnectedWorkDisplayLookup,
  useConnectedWorkDisplays,
} from '@/components/initiatives/use-connected-work-displays';

/** One Program container and the linked Projects inside it. */
export interface ConnectedWorkGroup {
  /** The linked Program this group is, or `null` for Projects under no linked Program. */
  readonly program: InitiativeConnectedWork | null;
  /** The linked Projects in this group, in the order the server returned them. */
  readonly projects: readonly InitiativeConnectedWork[];
}

/**
 * Bucket connected work into Program containers plus one ungrouped group.
 *
 * @remarks
 * A Project joins a Program's container only when that Program is itself linked to the Initiative —
 * otherwise the container would name work the reader cannot see from here. The ungrouped group is
 * always returned, even empty, because it carries the panel's own quick-add row.
 *
 * @param items - The Initiative's connected work.
 * @returns The Program containers in link order, then the ungrouped group.
 */
export function groupConnectedWork(
  items: readonly InitiativeConnectedWork[],
): readonly ConnectedWorkGroup[] {
  const programs = items.filter((item) => item.kind === 'program');
  const linkedProgramIds = new Set(programs.map((program) => program.id));
  const byProgram = new Map<string, InitiativeConnectedWork[]>();
  const ungrouped: InitiativeConnectedWork[] = [];

  for (const item of items) {
    if (item.kind !== 'project') continue;
    const programId = item.programId;
    if (programId !== null && linkedProgramIds.has(programId)) {
      const bucket = byProgram.get(programId);
      if (bucket === undefined) byProgram.set(programId, [item]);
      else bucket.push(item);
      continue;
    }
    ungrouped.push(item);
  }

  return [
    ...programs.map((program) => ({ program, projects: byProgram.get(program.id) ?? [] })),
    { program: null, projects: ungrouped },
  ];
}

/**
 * Count the connected work as the two things a reader distinguishes.
 *
 * @param items - The Initiative's connected work.
 * @param programNoun - The workspace's singular Program noun.
 * @param projectNoun - The workspace's singular Project noun.
 * @returns A phrase naming how much work there is, in the workspace's own nouns.
 */
export function describeConnectedWork(
  items: readonly InitiativeConnectedWork[],
  programNoun: string,
  projectNoun: string,
): string {
  const projects = items.filter((item) => item.kind === 'project').length;
  const programs = items.length - projects;
  const plural = (count: number, noun: string): string =>
    `${String(count)} ${count === 1 ? noun.toLowerCase() : `${noun.toLowerCase()}s`}`;
  const projectPart = plural(projects, projectNoun);
  if (programs === 0) return projectPart;
  return `${projectPart} across ${plural(programs, programNoun)}`;
}

/** The writes this panel reports up to the Initiative page. */
export interface ConnectedWorkActions {
  /** Whether the viewer may contribute; false hides every create, link, and unlink control. */
  readonly canEdit: boolean;
  /** Whether a link or unlink is in flight. */
  readonly busy: boolean;
  /** The org's Projects not already linked, for the link picker. */
  readonly projectOptions: readonly PickerOption[];
  /** The org's Programs not already linked, for the link picker. */
  readonly programOptions: readonly PickerOption[];
  /** Whether the candidate rosters are still loading. */
  readonly optionsLoading: boolean;
  /** Link an existing Project to this Initiative. */
  /** Current placement, used to avoid offering a Project beneath the wrong Program. */
  readonly projectProgramIds: ReadonlyMap<string, string | null>;
  readonly onLinkProject: (projectId: string) => void;
  /** Link an existing Program to this Initiative. */
  readonly onLinkProgram: (programId: string) => void;
  /** Unlink a directly-linked row from this Initiative. */
  readonly onUnlink: (kind: 'program' | 'project', id: string) => void;
  /** Open the full Project composer, pre-seeded with this Initiative and the given Program. */
  readonly onCreateProject: (programId: string | null) => void;
  /** Create a Project from a typed name, linked to this Initiative and the given Program. */
  readonly onQuickAddProject: (name: string, programId: string | null) => Promise<void>;
}

/** Props for {@link InitiativeConnectedWorkPanel}. */
export interface InitiativeConnectedWorkPanelProps {
  /** Workspace whose detail route projects these rows. */
  readonly routeOrganizationId: string;
  /** The Initiative these rows hang from, carried into each object's own menu. */
  readonly initiativeId: string;
  readonly connectedWork: readonly InitiativeConnectedWork[];
  /** True while the relationship sections are loading. */
  readonly loading: boolean;
  readonly initiativeNoun: string;
  readonly programNoun: string;
  readonly projectNoun: string;
  readonly actions: ConnectedWorkActions;
}

/** Props for the private {@link RowMenu}. */
interface RowMenuProps {
  readonly name: string;
}

/**
 * The object's own menu.
 *
 * @remarks
 * Deliberately not a menu built here. `openFor` opens the shared object menu the right-click
 * gesture already opens, so an overflow button and a right-click can never drift into offering
 * different things — including "Remove from this {initiative}", which is registered as a Project
 * and Program action rather than as a control this panel owns. It renders in the object row's own
 * trailing slot, because that menu finds its subject by walking up from the control that opened
 * it: a button outside the object's surface opens a menu that knows about nothing.
 *
 * `sm` is the documented step for an inline row affordance, reached through `controlSize` rather
 * than by overriding a larger step's geometry — an icon button with a hand-written size is one
 * more control the scale does not know about.
 *
 * It rests visible. A menu revealed only on hover is unreachable on a touch screen, invisible to
 * anyone scanning for what a row can do, and it made the tree look as though only some kinds of
 * row had actions at all.
 */
function RowMenu({ name }: RowMenuProps): JSX.Element | null {
  const objectMenu = useObjectContextMenu();

  if (objectMenu === null) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      iconOnly
      controlSize="sm"
      aria-label={`${name} actions`}
      onClick={(event) => {
        objectMenu.openFor(event.currentTarget);
      }}
    >
      <Ellipsis aria-hidden />
    </Button>
  );
}

/** Props for the private {@link LooseProjects}. */
interface LooseProjectsProps {
  readonly projects: readonly InitiativeConnectedWork[];
  readonly routeOrganizationId: string;
  readonly initiativeId: string;
  readonly projectNoun: string;
  readonly actions: ConnectedWorkActions;
  readonly addGroups: readonly AddOrLinkGroup[];
  readonly displayFor: ConnectedWorkDisplayLookup;
}

/**
 * The Projects under no linked Program, and the field that adds beside them.
 *
 * @remarks
 * These sit at the top level of the list, as siblings of the Program containers rather than in a
 * group of their own — there is no "no program" container, because that would be a box drawn
 * around an absence.
 */
function LooseProjects({
  projects,
  routeOrganizationId,
  initiativeId,
  projectNoun,
  actions,
  addGroups,
  displayFor,
}: LooseProjectsProps): JSX.Element {
  const projectNounLower = projectNoun.toLowerCase();

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {projects.map((project) => (
        <ConnectedProjectRow
          key={project.id}
          item={project}
          routeOrganizationId={routeOrganizationId}
          initiativeId={initiativeId}
          menu={<RowMenu name={project.name} />}
          display={displayFor('project', project.id)}
        />
      ))}
      <AddOrLinkRow
        canEdit={actions.canEdit}
        noun={projectNounLower}
        placeholder={`Add a ${projectNounLower}…`}
        onCreate={(name) => actions.onQuickAddProject(name, null)}
        groups={addGroups}
        loading={actions.optionsLoading}
      />
    </div>
  );
}

/** The Initiative's Connected work tab body. */
export function InitiativeConnectedWorkPanel({
  routeOrganizationId,
  initiativeId,
  connectedWork,
  loading,
  initiativeNoun,
  programNoun,
  projectNoun,
  actions,
}: InitiativeConnectedWorkPanelProps): JSX.Element {
  const displayFor = useConnectedWorkDisplays(routeOrganizationId, !loading);
  const projectGroup: AddOrLinkGroup = {
    label: `${projectNoun}s`,
    options: actions.projectOptions,
    onSelect: actions.onLinkProject,
  };
  const looseGroups: readonly AddOrLinkGroup[] = [
    projectGroup,
    { label: `${programNoun}s`, options: actions.programOptions, onSelect: actions.onLinkProgram },
  ];

  if (loading) {
    return (
      <p className="text-on-surface-variant text-body-small px-1 py-8 text-center">
        Loading connected work…
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {connectedWork.length === 0 ? (
        <p className="text-on-surface-variant text-body-medium px-1">
          Nothing advances this {initiativeNoun.toLowerCase()} yet. Name a{' '}
          {projectNoun.toLowerCase()} below — it will be created, or attached if it already exists.
        </p>
      ) : null}
      {groupConnectedWork(connectedWork).map((group) =>
        group.program === null ? (
          <LooseProjects
            key="ungrouped"
            projects={group.projects}
            routeOrganizationId={routeOrganizationId}
            initiativeId={initiativeId}
            projectNoun={projectNoun}
            actions={actions}
            addGroups={looseGroups}
            displayFor={displayFor}
          />
        ) : (
          <ConnectedProgramGroup
            key={group.program.id}
            program={group.program}
            projects={group.projects}
            routeOrganizationId={routeOrganizationId}
            initiativeId={initiativeId}
            projectNoun={projectNoun}
            canEdit={actions.canEdit}
            addGroups={[
              {
                ...projectGroup,
                options: projectGroup.options.filter(
                  (option) => actions.projectProgramIds.get(option.value) === group.program?.id,
                ),
              },
            ]}
            optionsLoading={actions.optionsLoading}
            onCreate={(name) => actions.onQuickAddProject(name, group.program?.id ?? null)}
            renderMenu={(name) => <RowMenu name={name} />}
            displayFor={displayFor}
          />
        ),
      )}
    </div>
  );
}
