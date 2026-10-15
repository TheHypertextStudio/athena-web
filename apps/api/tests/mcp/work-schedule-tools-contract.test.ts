import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { WorkScheduleRead, WorkScheduleCommand } from '../../src/mcp/work-schedule-tools-contract';
import { defineTemplateDefinition } from '../../src/mcp/template-tools-contract';

const id = '01M50P7S91S499N4C4GWHC99FC';

describe('canonical schedule MCP arguments', () => {
  it('bounds discovery and correlates detail/history arguments', () => {
    expect(WorkScheduleRead.parse({ action: 'list' })).toMatchObject({ limit: 50 });
    expect(WorkScheduleRead.safeParse({ action: 'list', limit: 101 }).success).toBe(false);
    expect(WorkScheduleRead.safeParse({ action: 'detail', scheduleId: id }).success).toBe(true);
    expect(
      WorkScheduleRead.safeParse({ action: 'detail', scheduleId: id, cursor: 'x' }).success,
    ).toBe(false);
    expect(
      WorkScheduleRead.safeParse({ action: 'history', scheduleId: id, limit: 100 }).success,
    ).toBe(true);
  });

  it('rejects irrelevant fields and retained authority on every command', () => {
    expect(WorkScheduleCommand.safeParse({ action: 'pause', scheduleId: id }).success).toBe(true);
    expect(
      WorkScheduleCommand.safeParse({ action: 'pause', scheduleId: id, occurrenceId: id }).success,
    ).toBe(false);
    expect(WorkScheduleCommand.safeParse({ action: 'retry', scheduleId: id }).success).toBe(false);
    expect(
      WorkScheduleCommand.safeParse({
        action: 'retry',
        scheduleId: id,
        occurrenceId: id,
        claim: {},
      }).success,
    ).toBe(false);
    expect(
      WorkScheduleCommand.safeParse({
        action: 'run',
        scheduleId: id,
        run: { scheduledFor: '2026-02-30' },
      }).success,
    ).toBe(false);
  });

  it('requires explicit checked future authoring and never accepts forests', () => {
    expect(
      WorkScheduleCommand.safeParse({ action: 'revise', scheduleId: id, revision: {} }).success,
    ).toBe(false);
    expect(
      WorkScheduleCommand.safeParse({
        action: 'create',
        schedule: { document: { kind: 'forest' } },
      }).success,
    ).toBe(false);
  });

  it('exposes explicit Program defaults without inserting them on omission', () => {
    const input = z.object(defineTemplateDefinition.inputSchema);
    expect(input.parse({ orgId: id, action: 'draft' })).not.toHaveProperty('defaultSchedules');
    expect(input.parse({ orgId: id, action: 'draft', defaultSchedules: [] })).toHaveProperty(
      'defaultSchedules',
      [],
    );
    expect(
      input.safeParse({ orgId: id, action: 'draft', defaultSchedules: Array(21).fill({}) }).success,
    ).toBe(false);
  });
});
