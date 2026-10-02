import { describe, expect, it } from 'vitest';
import type { PlanOp } from '../src/contracts/plan-draft';
import { LabelId, TemplateId } from '../src/ids';
import { EMPTY_PLAN_DOCUMENT, applyPlanOps } from '../src/plan-draft';

const labelIds = [LabelId.parse('01M3ZE8NXAE778EA4KMXQR0XE3')];
const templateId = TemplateId.parse('01M3ZE8NXAHRAW9ED8M12345FM');
const env = { templatePayload: () => ({ targetType: 'task' as const, labelIds }) };
const initial: PlanOp[] = [
  { op: 'upsert_node', node: { ref: 'i', kind: 'initiative', fields: { title: 'Strategy' } } },
  {
    op: 'upsert_node',
    node: { ref: 'p', kind: 'project', parentRef: 'i', fields: { title: 'Project' } },
  },
  {
    op: 'upsert_node',
    node: { ref: 't', kind: 'task', parentRef: 'p', fields: { title: 'Task' } },
  },
];

/** Read the node whose label provenance the operations must preserve. */
function task(ops: PlanOp[]) {
  return applyPlanOps(EMPTY_PLAN_DOCUMENT, [...initial, ...ops], env).nodes.find(
    (node) => node.ref === 't',
  );
}

describe('plan template label provenance', () => {
  it('records copied defaults independently of later template edits', () => {
    expect(task([{ op: 'apply_template', ref: 't', templateId }])?.inheritedLabelIds).toEqual(
      labelIds,
    );
  });

  it.each(['set_fields', 'upsert_node'] as const)(
    'clears inheritance on explicit %s labels even when equal',
    (op) => {
      const edit: PlanOp =
        op === 'set_fields'
          ? { op, ref: 't', fields: { labelIds } }
          : { op, node: { ref: 't', kind: 'task', fields: { labelIds } } };
      const result = task([{ op: 'apply_template', ref: 't', templateId }, edit]);
      expect(result?.fields.labelIds).toEqual(labelIds);
      expect(result?.inheritedLabelIds).toBeUndefined();
    },
  );

  it.each(['set_fields', 'upsert_node'] as const)(
    'keeps inheritance through unrelated %s edits',
    (op) => {
      const edit: PlanOp =
        op === 'set_fields'
          ? { op, ref: 't', fields: { description: 'Completed body' } }
          : { op, node: { ref: 't', kind: 'task', fields: { description: 'Completed body' } } };
      expect(
        task([{ op: 'apply_template', ref: 't', templateId }, edit])?.inheritedLabelIds,
      ).toEqual(labelIds);
    },
  );

  it('preserves explicit labels supplied before template application', () => {
    const result = task([
      { op: 'set_fields', ref: 't', fields: { labelIds } },
      { op: 'apply_template', ref: 't', templateId },
    ]);
    expect(result?.fields.labelIds).toEqual(labelIds);
    expect(result?.inheritedLabelIds).toBeUndefined();
  });
});
