import { describe, expect, it } from 'vitest';
import { aggregateUpdateChanges } from '../../src/mcp/update-batch';
import { addRetainedManualPinField, diff } from '../../src/mcp/update-display';
import type { FieldDiff } from '../../src/mcp/catalog-rows';

describe('bulk blueprint update receipts and report', () => {
  it('keeps the original before and final after when direct and derived changes share a row', () => {
    const changes = aggregateUpdateChanges([
      {
        kind: 'task',
        id: 'child',
        op: 'update',
        before: { title: 'Original', dueDate: '2026-10-18' },
        after: { title: 'Edited', dueDate: '2026-10-18' },
      },
      {
        kind: 'task',
        id: 'child',
        op: 'update',
        before: { title: 'Edited', dueDate: '2026-10-18' },
        after: { title: 'Edited', dueDate: '2026-10-23' },
      },
      { kind: 'blocks', from: 'child', to: 'next', linked: true },
    ]);
    expect(changes).toEqual([
      {
        kind: 'task',
        id: 'child',
        op: 'update',
        before: { title: 'Original', dueDate: '2026-10-18' },
        after: { title: 'Edited', dueDate: '2026-10-23' },
      },
      { kind: 'blocks', from: 'child', to: 'next', linked: true },
    ]);
  });
  it('explains a manual pin without exposing internal origin or template state JSON', () => {
    const before = {
      dueDate: null,
      blueprintDateBindings: { dueDate: { manual: false, path: ['private-key'] } },
      blueprintOrigin: { rootId: 'private-root' },
    };
    const fields = diff(before, {
      ...before,
      blueprintDateBindings: { dueDate: { manual: true, path: ['private-key'] } },
    });
    expect(fields).toEqual([
      { field: 'Template dates', from: 'Template managed', to: 'Manually set' },
    ]);
    expect(JSON.stringify(fields)).not.toContain('private-');
  });
  it('reports only the initiating private pin once and omits its private identifiers', () => {
    const fields: FieldDiff[] = [];
    const change = {
      kind: 'retained_date_ownership',
      id: 'private-occurrence:private-step:dueDate',
      op: 'update' as const,
      before: { manual: false },
      after: { manual: true, workKind: 'task', workId: 'initiating-task' },
    };
    addRetainedManualPinField(fields, [change], 'task', 'other-task');
    expect(fields).toEqual([]);
    addRetainedManualPinField(fields, [change, change], 'task', 'initiating-task');
    addRetainedManualPinField(fields, [change], 'task', 'initiating-task');
    expect(fields).toEqual([
      { field: 'Template dates', from: 'Template managed', to: 'Manually set' },
    ]);
    expect(JSON.stringify(fields)).not.toMatch(/private-|initiating-task/);
  });
});
