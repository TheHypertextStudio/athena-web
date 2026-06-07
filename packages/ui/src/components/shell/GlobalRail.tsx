'use client';

/**
 * `@docket/ui` — the persistent left-edge org rail.
 *
 * @remarks
 * The {@link GlobalRail} is always visible: a Hub button at the top, one
 * {@link RailOrgAvatar} per membership, and an {@link AddOrgButton} at the bottom.
 * Selecting the Hub or an org rebinds the active context via {@link useContextState}, which
 * propagates the org accent and density to the rest of the shell.
 */
import * as React from 'react';

import { Home, Plus } from '../../icons';
import { cn } from '../../lib/utils';
import { Button } from '../../primitives';
import { HUB_CONTEXT, useContextState } from './ContextProvider';
import { RailOrgAvatar } from './RailOrgAvatar';

/** A single org membership rendered in the {@link GlobalRail}. */
export interface RailOrg {
  /** The org's id. */
  id: string;
  /** The org's display name. */
  name: string;
  /** Optional avatar image URL. */
  avatar?: string | null;
}

/** Props for {@link AddOrgButton}. */
export interface AddOrgButtonProps {
  /** Invoked when the user requests to add/join an org. */
  onAddOrg?: () => void;
}

/** The "add organization" affordance at the foot of the {@link GlobalRail}. */
export function AddOrgButton({ onAddOrg }: AddOrgButtonProps): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Add organization"
      title="Add organization"
      onClick={onAddOrg}
      className="border-border text-muted-foreground h-9 w-9 rounded-full border border-dashed"
    >
      <Plus aria-hidden="true" />
    </Button>
  );
}

/** Props for {@link GlobalRail}. */
export interface GlobalRailProps {
  /** The orgs the actor belongs to, rendered top-to-bottom. */
  orgs: readonly RailOrg[];
  /** Invoked when the user requests to add/join an org. */
  onAddOrg?: () => void;
}

/**
 * The persistent org rail: Hub button, per-org avatars, and the add-org affordance.
 *
 * @remarks
 * Reads and mutates the active context via {@link useContextState}; the Hub button and the
 * active org avatar reflect the current binding.
 */
export function GlobalRail({ orgs, onAddOrg }: GlobalRailProps): React.JSX.Element {
  const { context, isHub, setContext } = useContextState();

  return (
    <nav
      aria-label="Organizations"
      className="border-border bg-card flex h-full w-16 shrink-0 flex-col items-center gap-3 border-r py-3"
    >
      <Button
        type="button"
        variant={isHub ? 'secondary' : 'ghost'}
        size="icon"
        aria-label="Hub"
        aria-current={isHub ? 'page' : undefined}
        title="Hub"
        onClick={() => {
          setContext(HUB_CONTEXT);
        }}
        className={cn('h-9 w-9 rounded-full', isHub && 'text-foreground')}
      >
        <Home aria-hidden="true" />
      </Button>

      <div className="flex flex-1 flex-col items-center gap-2 overflow-y-auto">
        {orgs.map((org) => (
          <RailOrgAvatar
            key={org.id}
            orgId={org.id}
            name={org.name}
            avatarUrl={org.avatar}
            active={context === org.id}
            onSelect={setContext}
          />
        ))}
      </div>

      <AddOrgButton onAddOrg={onAddOrg} />
    </nav>
  );
}
