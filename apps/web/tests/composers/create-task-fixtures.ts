interface TaskTemplateFixture {
  readonly id: string;
  readonly organizationId: string;
  readonly targetType: 'task';
  readonly name: string;
  readonly description: null;
  readonly scope: 'organization' | 'personal' | 'team';
  readonly ownerActorId: string | null;
  readonly teamId: string | null;
  readonly payload: { readonly targetType: 'task' };
  readonly isSeed: boolean;
  readonly createdAt: string;
}
/** Make one task template row without coupling tests to DTO implementation details. */
export function taskTemplate(
  organizationId: string,
  name: string,
  scope: 'organization' | 'personal' | 'team',
  ownerActorId: string | null,
  teamId: string | null,
): TaskTemplateFixture {
  return {
    id: `${name.replaceAll(' ', '_')}_id`,
    organizationId,
    targetType: 'task',
    name,
    description: null,
    scope,
    ownerActorId,
    teamId,
    payload: { targetType: 'task' },
    isSeed: false,
    createdAt: '2026-01-01T00:00:00Z',
  };
}
