'use client';

/** Dedicated Initiative relationship tabs composed from first-class object rows. */
import type {
  InitiativeConnectedWork,
  InitiativeHierarchyReference,
} from '@docket/work/initiative-contract';
import { Plus } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import type { JSX } from 'react';

import { useWorkStatusResolver } from '@/components/entity-display/use-work-status';
import {
  type ConnectedWorkActions,
  InitiativeConnectedWorkPanel,
} from '@/components/initiatives/initiative-connected-work';
import { ObjectListRow } from '@/components/objects/object-list-row';

/** Relationship tabs this component owns. Other tabs render nothing here. */
export type InitiativeRelationshipTab = 'subinitiatives' | 'work';

/** Props for {@link InitiativeRelationshipPanels}. */
export interface InitiativeRelationshipPanelsProps {
  readonly tab: string;
  /** Workspace whose detail route projects the relationship rows. */
  readonly routeOrganizationId: string;
  /** The Initiative these sections belong to. */
  readonly initiativeId: string;
  readonly children: readonly InitiativeHierarchyReference[];
  readonly connectedWork: readonly InitiativeConnectedWork[];
  /** True while the selected relationship section is loading. */
  readonly loading?: boolean;
  readonly initiativeNoun: string;
  /** The plural Initiative noun, for the truncation notice's own links. */
  readonly initiativePlural: string;
  readonly programNoun: string;
  readonly projectNoun: string;
  /** Whether the server capped the relationship scan, so these sections are incomplete. */
  readonly truncated: boolean;
  readonly onAddSubinitiative: () => void;
  /** The create/link/unlink writes the Connected work panel reports up to the page. */
  readonly connectedWorkActions: ConnectedWorkActions;
}

/** Props for the private {@link TruncationNotice}. */
interface TruncationNoticeProps {
  readonly organizationId: string;
  readonly initiativePlural: string;
  readonly programNoun: string;
  readonly projectNoun: string;
}

/** Say that the server capped the scan, and where the complete lists live. */
function TruncationNotice({
  organizationId,
  initiativePlural,
  programNoun,
  projectNoun,
}: TruncationNoticeProps): JSX.Element {
  return (
    <p className="text-on-surface-variant text-sm">
      Some relationships are not shown. Browse all{' '}
      <Link href={`/orgs/${organizationId}/initiatives`} className="underline">
        {initiativePlural.toLowerCase()}
      </Link>
      ,{' '}
      <Link href={`/orgs/${organizationId}/projects`} className="underline">
        {projectNoun.toLowerCase()}s
      </Link>
      , or{' '}
      <Link href={`/orgs/${organizationId}/programs`} className="underline">
        {programNoun.toLowerCase()}s
      </Link>
      .
    </p>
  );
}

/** Render the active relationship collection as standard interactive objects. */
export function InitiativeRelationshipPanels({
  tab,
  routeOrganizationId,
  initiativeId,
  children,
  connectedWork,
  loading = false,
  initiativeNoun,
  initiativePlural,
  programNoun,
  projectNoun,
  truncated,
  onAddSubinitiative,
  connectedWorkActions,
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
        {truncated ? (
          <TruncationNotice
            organizationId={routeOrganizationId}
            initiativePlural={initiativePlural}
            programNoun={programNoun}
            projectNoun={projectNoun}
          />
        ) : null}
        <div className="flex justify-end">
          <Button variant="secondary" className="min-h-10 gap-2" onClick={onAddSubinitiative}>
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
        {truncated ? (
          <TruncationNotice
            organizationId={routeOrganizationId}
            initiativePlural={initiativePlural}
            programNoun={programNoun}
            projectNoun={projectNoun}
          />
        ) : null}
        <InitiativeConnectedWorkPanel
          routeOrganizationId={routeOrganizationId}
          initiativeId={initiativeId}
          connectedWork={connectedWork}
          loading={loading}
          initiativeNoun={initiativeNoun}
          programNoun={programNoun}
          projectNoun={projectNoun}
          actions={connectedWorkActions}
        />
      </div>
    );
  }

  return null;
}
