import { describe, expect, it, vi } from 'vitest';
import { resolveNativeScheduleCaller } from '../../src/lib/recurrence/schedule-native-caller';
import type { TemplateTransaction } from '../../src/lib/templates/persistence';
import type { NativeScheduleCallerRequest } from '../../src/lib/recurrence/schedule-native-caller';
const mocks = vi.hoisted(() => ({ schedule: vi.fn(), work: vi.fn(), writable: vi.fn() }));
vi.mock('../../src/lib/recurrence/schedule-access', () => ({
  requireScheduleAccess: mocks.schedule,
}));
vi.mock('../../src/lib/work-creation/context', () => ({
  loadCreationActor: vi.fn(async (_tx, orgId, actorId) => ({
    orgId,
    actorId,
    roleId: null,
    capabilities: [],
  })),
}));
vi.mock('../../src/lib/work-template-selection', () => ({ requireWorkAccess: mocks.work }));
vi.mock('../../src/product-capability', () => ({ assertSharedWorkWritable: mocks.writable }));
const tx = {} as TemplateTransaction;
const rows = {
  series: { id: 'series', createdBy: 'revoked-creator' },
  revision: {},
  document: {},
  roots: [{ key: 'root', kind: 'task', id: 'actual-task' }],
} as unknown as Parameters<typeof resolveNativeScheduleCaller>[1];
function caller(input: Partial<NativeScheduleCallerRequest>) {
  return resolveNativeScheduleCaller(tx, rows, { organizationId: 'org', ...input });
}
describe('native foreground authority after creator revocation', () => {
  it('allows the actual contributor while keeping provider execution creator-gated', async () => {
    mocks.schedule.mockRejectedValue(new Error('Creator revoked'));
    await expect(
      caller({ actorId: 'contributor', initiatingWork: { kind: 'task', id: 'actual-task' } }),
    ).resolves.toMatchObject({ actorId: 'contributor' });
    expect(mocks.work).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ actorId: 'contributor' }),
      'task',
      'actual-task',
    );
    await expect(caller({})).rejects.toThrow('Creator revoked');
  });
  it('does not turn an unrelated initiating row into native authority', async () => {
    await expect(
      caller({ actorId: 'contributor', initiatingWork: { kind: 'task', id: 'unrelated-task' } }),
    ).rejects.toThrow();
  });
});
