'use client';

/**
 * One Project in the Initiative's connected-work tree: a title container you can open, and the
 * detail it opens onto.
 *
 * @remarks
 * Collapsed, the row is the object: its own icon, its name, and the summary someone wrote. Opened,
 * it answers the next question without making anyone leave the Initiative — the Project's own
 * description, the stage it is in by name, and whichever of health, lead, timeline and task
 * progress has actually been set.
 *
 * That detail is read only when a row is opened. The connected-work payload deliberately carries
 * none of it — loading a lead, a timeline and a progress roll-up for every Project on a tab where
 * most rows are never opened is a cost paid for nothing. The read is the Project's own detail
 * aggregate, so opening a row here also warms the page it links to.
 */
import type { EntityDisplayOut } from '@docket/work/entity-display-contract';
import type { InitiativeConnectedWork } from '@docket/work/initiative-contract';
import { Collapsible, CollapsibleContent, Surface } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { DisclosureToggle } from '@/components/initiatives/disclosure-toggle';
import { ProjectExpansion } from '@/components/initiatives/project-expansion';
import { EntityIconGlyph } from '@/components/entity-display/entity-icon-glyph';
import { ObjectListRow } from '@/components/objects/object-list-row';

/** Props for {@link ConnectedProjectRow}. */
export interface ConnectedProjectRowProps {
  readonly item: InitiativeConnectedWork;
  /** Workspace whose detail route projects this row. */
  readonly routeOrganizationId: string;
  /** The Initiative this row was reached through, carried into the object's own menu. */
  readonly initiativeId: string;
  /** The object's own overflow menu, rendered beside the row rather than inside it. */
  readonly menu: JSX.Element | null;
  /** The Project's identity mark — its own if customized, the kind's default otherwise. */
  readonly display: EntityDisplayOut;
}

/** An expandable Project container. */
export function ConnectedProjectRow({
  item,
  routeOrganizationId,
  initiativeId,
  menu,
  display,
}: ConnectedProjectRowProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const crossWorkspace = item.organizationId !== routeOrganizationId;
  const summary = item.summary?.trim() ?? '';
  const description = item.direct ? summary : `Inherited${summary ? ` · ${summary}` : ''}`;

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <Surface tone="floating" shape="small" pad="tight" className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1">
          <DisclosureToggle open={open} label={item.name} />
          <ObjectListRow
            object={{
              kind: 'project',
              id: item.id,
              organizationId: item.organizationId,
              title: item.name,
              // The edge this row was reached through, so the object's own "Remove from this
              // initiative" action knows which link to cut.
              meta: { initiativeId, directLink: item.direct },
            }}
            href={`/orgs/${item.organizationId}/projects/${item.id}`}
            density="compact"
            icon={
              <EntityIconGlyph
                subjectType={display.subjectType}
                glyph={display.glyph}
                colorKey={display.colorKey}
                customColor={display.customColor}
                size={32}
              />
            }
            {...(description.length > 0 ? { description } : {})}
            dragDisabled={crossWorkspace}
            actionScope={crossWorkspace ? 'reference' : 'all'}
            surfaceId="initiative-connected-work"
            className="hover:bg-surface-container-highest min-w-0 flex-1 bg-transparent px-0"
            // The menu rides in the row's own trailing slot rather than beside it: the shared object
            // menu finds its subject by walking up from the control that opened it, so a button
            // outside the object's surface opens a menu that knows about nothing.
            trailing={menu}
          />
        </div>
        <CollapsibleContent>
          {/* Flush with the title above it: the disclosure (28px, 40px on touch), its gap (4px), the identity mark
            (32px) and the row's own gap (8px). Anything else reads as a third indent level that
            does not exist. */}
          <div className="coarse:pl-21 pl-18">
            <ProjectExpansion
              organizationId={item.organizationId}
              projectId={item.id}
              enabled={open}
            />
          </div>
        </CollapsibleContent>
      </Surface>
    </Collapsible>
  );
}
