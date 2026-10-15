import { describe, expect, it } from 'vitest';
import { WorkspaceSettingsOut, WorkspaceSettingsUpdate } from '../../../src/contracts/organization';

describe('workspace settings DTOs', () => {
  it('accepts Initiative maximum depths from one through five', () => {
    // Out is what the server sends, so every field is present — including estimationScale, which
    // has no default precisely because a workspace's scale is always a real stored choice.
    expect(
      WorkspaceSettingsOut.parse({
        initiativeMaxDepth: 2,
        autoCompleteParentTasks: true,
        estimationScale: 'fibonacci',
        fiscalYearStartMonth: 0,
        workingWeekdays: [1, 2, 3, 4, 5],
      }).initiativeMaxDepth,
    ).toBe(2);
    expect(WorkspaceSettingsUpdate.parse({ initiativeMaxDepth: 1 }).initiativeMaxDepth).toBe(1);
    expect(WorkspaceSettingsUpdate.parse({ initiativeMaxDepth: 5 }).initiativeMaxDepth).toBe(5);
  });

  it('rejects Initiative maximum depths outside one through five', () => {
    expect(WorkspaceSettingsUpdate.safeParse({ initiativeMaxDepth: 0 }).success).toBe(false);
    expect(WorkspaceSettingsUpdate.safeParse({ initiativeMaxDepth: 6 }).success).toBe(false);
  });
});
