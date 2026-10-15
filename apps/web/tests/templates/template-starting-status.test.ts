import { describe, expect, it } from 'vitest';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { TeamId } from '@docket/identity-access/ids';
import { templateStartingStatus } from '@/components/composer/template-starting-status';

const statuses = [
  { key: 'backlog', name: 'Backlog', isDefault: true },
  { key: 'in_progress', name: 'In Progress', isDefault: false },
];
const sets = [{ entityType: 'task' as const, teamId: null, statuses }];
function template(state: string, defaultStatusKey: string | null = null) {
  return {
    targetType: 'task' as const,
    definition: WorkTemplateDefinition.parse({
      name: 'Preparation',
      defaultStatusKey,
      payload: { targetType: 'task', state },
    }),
  };
}

describe('canonical template starting workflow', () => {
  it('retains a Task starting state instead of silently selecting backlog', () => {
    expect(templateStartingStatus(template('in_progress'), sets, null)).toBe('in_progress');
  });
  it('prefers the explicit publication status default over its starting payload', () => {
    expect(templateStartingStatus(template('in_progress', 'backlog'), sets, null)).toBe('backlog');
  });
  it('resolves ordinary display names like server creation does', () => {
    expect(templateStartingStatus(template('IN PROGRESS'), sets, null)).toBe('in_progress');
  });
  it('uses the destination team fork and falls back for a retired key', () => {
    const teamId = TeamId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    const fork = {
      entityType: 'task' as const,
      teamId,
      statuses: [{ key: 'queue', name: 'Queue', isDefault: true }],
    };
    expect(templateStartingStatus(template('in_progress'), [...sets, fork], teamId)).toBe('queue');
  });
});
