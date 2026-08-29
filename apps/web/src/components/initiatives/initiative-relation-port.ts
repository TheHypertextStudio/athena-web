import type {
  RelationCommandPort,
  RelationEndpoint,
  RelationIntent,
} from '@docket/work/relation-contract';

import type { InitiativeHierarchyMutation } from './initiative-hierarchy-mutations';

/** A non-noop Initiative hierarchy command resolved from one relation intent. */
export interface ResolvedInitiativeParentIntent {
  readonly organizationId: string;
  readonly mutation: Exclude<InitiativeHierarchyMutation, { readonly kind: 'noop' }>;
}

/** Initiative-parent intent accepted by the Initiative application domain. */
export interface InitiativeParentIntent extends Omit<
  RelationIntent,
  'relationId' | 'subjects' | 'target'
> {
  readonly relationId: 'initiative.parent' | 'initiative.root';
  readonly subjects: readonly (RelationEndpoint & { readonly kind: 'initiative' })[];
  readonly target: RelationEndpoint & {
    readonly kind: 'initiative' | 'initiative_root';
  };
}

/** Dependencies supplied to the Initiative relation adapter. */
export interface InitiativeParentCommandDependencies {
  /** Persist one Initiative-owned hierarchy mutation through its typed API adapter. */
  readonly write: (organizationId: string, mutation: InitiativeHierarchyMutation) => Promise<void>;
}

/**
 * Resolve one Initiative parent intent before a caller claims its shared child lock.
 *
 * @param intent - The Initiative parent or top-level relation request.
 * @returns The route-scoped write, or null when the request cannot change the hierarchy.
 */
export function resolveInitiativeParentIntent(
  intent: InitiativeParentIntent,
): ResolvedInitiativeParentIntent | null {
  const subject = intent.subjects[0];
  const organizationId = intent.target.organizationId;
  if (subject === undefined || organizationId === null) return null;
  const parentLinkId = subject.meta?.['parentLinkId'];
  if (intent.relationId === 'initiative.root') {
    if (typeof parentLinkId !== 'string') return null;
    return {
      organizationId,
      mutation: {
        kind: 'detach',
        linkId: parentLinkId,
        childInitiativeId: subject.id,
      },
    };
  }
  const parentInitiativeId = subject.meta?.['parentInitiativeId'];
  if (parentInitiativeId === intent.target.id) return null;
  return {
    organizationId,
    mutation:
      typeof parentLinkId === 'string'
        ? {
            kind: 'move',
            linkId: parentLinkId,
            parentInitiativeId: intent.target.id,
            childInitiativeId: subject.id,
          }
        : {
            kind: 'create',
            parentInitiativeId: intent.target.id,
            childInitiativeId: subject.id,
          },
  };
}

/**
 * Build the Initiative-owned command port used by every `initiative.parent` action entry point.
 *
 * @param dependencies - Typed Initiative persistence adapter.
 * @returns A narrowed relation command port.
 */
export function createInitiativeParentCommandPort(
  dependencies: InitiativeParentCommandDependencies,
): RelationCommandPort<InitiativeParentIntent> {
  return {
    execute: async (intent) => {
      const resolved = resolveInitiativeParentIntent(intent);
      if (resolved === null) return { status: 'unchanged' };
      await dependencies.write(resolved.organizationId, resolved.mutation);
      return { status: 'applied' };
    },
  };
}

/** Initiative property relations owned by the Initiative update route. */
export type InitiativePropertyRelationId =
  'initiative.lead-team' | 'initiative.owner' | 'initiative.label';

/** Narrow Initiative property intent accepted by the application port. */
export interface InitiativePropertyRelationIntent extends Omit<
  RelationIntent,
  'relationId' | 'subjects'
> {
  readonly relationId: InitiativePropertyRelationId;
  readonly subjects: readonly (RelationEndpoint & { readonly kind: 'initiative' })[];
}

/** Injected Initiative update operations. */
export interface InitiativePropertyCommandDependencies {
  readonly setProperty: (
    organizationId: string,
    initiativeId: string,
    patch: { readonly ownerId?: string; readonly leadTeamId?: string },
  ) => Promise<void>;
  readonly addLabel: (
    organizationId: string,
    initiativeId: string,
    labelId: string,
  ) => Promise<'applied' | 'unchanged'>;
}

/** Build the Initiative-owned property relation command port. */
export function createInitiativePropertyCommandPort(
  dependencies: InitiativePropertyCommandDependencies,
): RelationCommandPort<InitiativePropertyRelationIntent> {
  return {
    execute: async (intent) => {
      let applied = false;
      for (const subject of intent.subjects) {
        const organizationId = subject.organizationId;
        if (
          organizationId === null ||
          intent.target.organizationId === null ||
          intent.target.organizationId !== organizationId
        )
          continue;
        if (intent.relationId === 'initiative.label') {
          applied =
            (await dependencies.addLabel(organizationId, subject.id, intent.target.id)) ===
              'applied' || applied;
          continue;
        }
        const field =
          intent.relationId === 'initiative.owner' ? ('ownerId' as const) : ('leadTeamId' as const);
        if (subject.meta?.[field] === intent.target.id) continue;
        await dependencies.setProperty(organizationId, subject.id, {
          [field]: intent.target.id,
        });
        applied = true;
      }
      return { status: applied ? 'applied' : 'unchanged' };
    },
  };
}
