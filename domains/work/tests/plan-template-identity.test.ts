/** A saved plan retains the publication whose starting fields were applied. */
import { describe, expect, it } from 'vitest';
import { TemplateId, WorkTypeVersionId } from '../src/ids';
import { EMPTY_PLAN_DOCUMENT, applyPlanOps } from '../src/plan-draft';
import type { PlanOp } from '../src/contracts/plan-draft';

const templateId = TemplateId.parse('01M3ZE8NXAHRAW9ED8M12345FM');
const versionId = WorkTypeVersionId.parse('01M3ZE8NXAHRAW9ED8M12345FN');
const initial: PlanOp[] = [
  { op: 'upsert_node', node: { ref: 'i', kind: 'initiative', fields: { title: 'Strategy' } } },
];

describe('plan template publication provenance', () => {
  it('pins the current publication and keeps it through ordinary field edits', () => {
    const result = applyPlanOps(
      EMPTY_PLAN_DOCUMENT,
      [
        ...initial,
        { op: 'apply_template', ref: 'i', templateId },
        { op: 'set_fields', ref: 'i', fields: { description: 'Completed outline' } },
      ],
      {
        templatePayload: () => ({ targetType: 'initiative', description: '## Goal' }),
        templateVersionId: () => versionId,
      },
    );
    expect(result.nodes[0]).toMatchObject({ templateId, workTypeVersionId: versionId });
  });

  it('refuses an explicit version when the environment cannot resolve that publication', () => {
    expect(() =>
      applyPlanOps(
        EMPTY_PLAN_DOCUMENT,
        [...initial, { op: 'apply_template', ref: 'i', templateId, workTypeVersionId: versionId }],
        { templatePayload: () => ({ targetType: 'initiative' }) },
      ),
    ).toThrow('That published version does not exist here.');
  });

  it('keeps legacy private drafts without a publication and clears stale pins when attribution changes', () => {
    const env = {
      templatePayload: () => ({ targetType: 'initiative' as const }),
      templateVersionId: () => versionId,
    };
    const pinned = applyPlanOps(
      EMPTY_PLAN_DOCUMENT,
      [...initial, { op: 'apply_template', ref: 'i', templateId }],
      env,
    );
    const cleared = applyPlanOps(
      pinned,
      [{ op: 'upsert_node', node: { ref: 'i', kind: 'initiative', fields: {}, templateId: null } }],
      env,
    );
    expect(cleared.nodes[0]?.workTypeVersionId).toBeUndefined();
    const legacy = applyPlanOps(
      EMPTY_PLAN_DOCUMENT,
      [...initial, { op: 'apply_template', ref: 'i', templateId }],
      { templatePayload: () => ({ targetType: 'initiative' }) },
    );
    expect(legacy.nodes[0]?.workTypeVersionId).toBeUndefined();
  });
});
