/**
 * Where following a reference to a Docket entity goes.
 *
 * @remarks
 * One exhaustive switch, shared by every surface that resolves a reference, so a hovercard and a
 * Resources tab can never disagree about where the same mention leads. The switch has no default
 * arm: adding a mentionable kind fails to compile until its route exists, rather than shipping a
 * chip that navigates nowhere.
 */
import type { MentionRef } from '@docket/types';

/** A reference to a Docket entity, narrowed from the union. */
export type EntityMentionRef = Extract<MentionRef, { kind: 'entity' }>;

/**
 * Build the in-app path for an entity reference.
 *
 * @param orgId - The workspace the entity belongs to.
 * @param ref - The reference.
 * @returns The path to navigate to.
 */
export function entityMentionHref(orgId: string, ref: EntityMentionRef): string {
  const base = `/orgs/${orgId}`;
  switch (ref.entityKind) {
    case 'task':
      return `${base}/tasks/${ref.entityId}`;
    case 'project':
      return `${base}/projects/${ref.entityId}`;
    case 'program':
      return `${base}/programs/${ref.entityId}`;
    case 'initiative':
      return `${base}/initiatives/${ref.entityId}`;
    case 'cycle':
      return `${base}/cycles/${ref.entityId}`;
    case 'milestone':
      return `${base}/projects?milestoneId=${ref.entityId}`;
    case 'team':
      return `${base}/teams/${ref.entityId}`;
    case 'actor':
      return `${base}/people/${ref.entityId}`;
    case 'agent_session':
      return `${base}/sessions/${ref.entityId}`;
    case 'comment':
    case 'update':
      return `${base}/search?kind=${ref.entityKind}&id=${ref.entityId}`;
  }
}
