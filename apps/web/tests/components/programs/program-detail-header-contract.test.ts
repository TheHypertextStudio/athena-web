import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../../');
const detailPath = join(
  root,
  'apps/web/src/app/(app)/orgs/[orgId]/programs/[programId]/program-detail-client.tsx',
);

function source(): string {
  return readFileSync(detailPath, 'utf8');
}

describe('Program detail header contract', () => {
  it('uses the shared identity picker and adaptive section menu', () => {
    const detail = source();
    expect(detail).toContain('useEntityDisplay');
    expect(detail).toContain('<EntityIconPicker');
    expect(detail).toContain('overflow={{ menuLabel: `More ${programLabel} sections` }}');
    expect(detail).toContain('priority: 0');
  });

  it('shows health and flow in the document-first overview without a false percentage', () => {
    const detail = source();
    expect(detail).toContain('<LatestUpdateSummary');
    expect(detail).toContain('<FlowSnapshot');
    expect(detail).toContain('programFlowMetrics');
    expect(detail).toContain("enabled: aggregate !== null && tab === 'overview'");
    expect(detail).not.toContain('completionPercent');
  });
});
