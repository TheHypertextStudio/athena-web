'use client';

/** Dedicated Initiative relationship tabs composed from first-class object rows. */
import type { InitiativeConnectedWork, InitiativeHierarchyReference } from '@docket/types';
import { Plus } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { useWorkStatusResolver } from '@/components/entity-display/use-work-status';
import { ObjectListRow } from '@/components/objects/object-list-row';

/** Relationship tabs this component owns. Other tabs render nothing here. */
export type InitiativeRelationshipTab = 'subinitiatives' | 'work';

/** Props for {@link InitiativeRelationshipPanels}. */
export interface InitiativeRelationshipPanelsProps {
  readonly tab: string;
  /** Workspace whose detail route projects the relationship rows. */
  readonly routeOrganizationId: string;
  readonly children: readonly InitiativeHierarchyReference[];
  readonly connectedWork: readonly InitiativeConnectedWork[];
  /** True while the selected relationship section is loading. */
  readonly loading?: boolean;
  readonly initiativeNoun: string;
  readonly programNoun: string;
  readonly projectNoun: string;
  readonly onAddSubinitiative: () => void;
}

/** Render the active relationship collection as standard interactive objects. */
export function InitiativeRelationshipPanels({
  tab,
  routeOrganizationId,
  children,
  connectedWork,
  loading = false,
  initiativeNoun,
  programNoun,
  projectNoun,
  onAddSubinitiative,
}: InitiativeRelationshipPanelsProps): JSX.Element | null {
  const statusOf = useWorkStatusResolver('initiative');

  if (tab === 'subinitiatives') {
    return (
      <div
        role="tabpanel"
        id="tabpanel-subinitiatives"
        aria-labelledby="tab-subinitiatives"
        className="no-print flex min-w-0 flex-col gap-3"
      >
        <div className="flex justify-end">
          <Button variant="outline" className="min-h-10 gap-2" onClick={onAddSubinitiative}>
            <Plus aria-hidden className="size-5" />
            Add sub-{initiativeNoun.toLowerCase()}
          </Button>
        </div>
        {loading ? (
          <p className="text-on-surface-variant text-body-small rounded-xl px-4 py-8 text-center">
            Loading sub-{initiativeNoun.toLowerCase()}…
          </p>
        ) : children.length ? (
          <div className="flex flex-col gap-2">
            {children.map((child) => (
              <ObjectListRow
                key={child.id}
                object={{
                  kind: 'initiative',
                  id: child.id,
                  organizationId: child.organizationId,
                  title: child.name,
                  meta: {
                    parentInitiativeId: child.parentInitiativeId,
                    parentLinkId: child.parentLinkId,
                  },
                }}
                href={`/orgs/${child.organizationId}/initiatives/${child.id}`}
                description={child.crossWorkspace ? child.organizationName : undefined}
                trailing={statusOf(child.status).name}
                dragDisabled={child.crossWorkspace}
                actionScope={child.crossWorkspace ? 'reference' : 'all'}
                surfaceId="initiative-subinitiatives"
              />
            ))}
          </div>
        ) : (
          <p className="bg-surface-container-low text-on-surface-variant rounded-xl px-4 py-8 text-center text-sm">
            Nothing is nested under this {initiativeNoun.toLowerCase()} yet.
          </p>
        )}
      </div>
    );
  }

  if (tab === 'work') {
    return (
      <div
        role="tabpanel"
        id="tabpanel-work"
        aria-labelledby="tab-work"
        className="no-print flex min-w-0 flex-col gap-2"
      >
        {loading ? (
          <p className="text-on-surface-variant text-body-small rounded-xl px-4 py-8 text-center">
            Loading connected work…
          </p>
        ) : connectedWork.length ? (
          connectedWork.map((item) => {
            const noun = item.kind === 'program' ? programNoun : projectNoun;
            const crossWorkspace = item.organizationId !== routeOrganizationId;
            return (
              <ObjectListRow
                key={`${item.kind}-${item.id}`}
                object={{
                  kind: item.kind,
                  id: item.id,
                  organizationId: item.organizationId,
                  title: item.name,
                }}
                href={`/orgs/${item.organizationId}/${item.kind === 'program' ? 'programs' : 'projects'}/${item.id}`}
                description={`${noun}${item.direct ? '' : ' · inherited'}`}
                trailing={item.status.replaceAll('_', ' ')}
                dragDisabled={crossWorkspace}
                actionScope={crossWorkspace ? 'reference' : 'all'}
                surfaceId="initiative-connected-work"
              />
            );
          })
        ) : (
          <p className="bg-surface-container-low text-on-surface-variant rounded-xl px-4 py-8 text-center text-sm">
            No projects or programs are linked to this {initiativeNoun.toLowerCase()} yet.
          </p>
        )}
      </div>
    );
  }

  return null;
}
