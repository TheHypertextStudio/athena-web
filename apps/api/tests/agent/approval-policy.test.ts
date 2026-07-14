import { describe, expect, it } from 'vitest';

import {
  classifyTool,
  decideToolExecution,
  decideUserOwnedToolExecution,
  type ToolAnnotationHints,
  type ToolDecision,
} from '../../src/agent/approval-policy';

describe('classifyTool', () => {
  it('fails closed: missing annotations classify as a write', () => {
    expect(classifyTool(undefined)).toEqual({
      readOnly: false,
      destructive: false,
      openWorld: false,
    });
  });

  it('fails closed: annotations without readOnlyHint classify as a write', () => {
    expect(classifyTool({}).readOnly).toBe(false);
  });

  it('classifies readOnlyHint: true as a read', () => {
    expect(classifyTool({ readOnlyHint: true }).readOnly).toBe(true);
  });

  it('passes destructive and open-world hints through', () => {
    const cls = classifyTool({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
    expect(cls).toEqual({ readOnly: false, destructive: true, openWorld: true });
  });

  it('treats explicit false hints as false', () => {
    const cls = classifyTool({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(cls).toEqual({ readOnly: true, destructive: false, openWorld: false });
  });
});

describe('decideUserOwnedToolExecution', () => {
  const READ = classifyTool({ readOnlyHint: true });
  const ROUTINE_WRITE = classifyTool({ readOnlyHint: false });
  const DESTRUCTIVE_WRITE = classifyTool({ readOnlyHint: false, destructiveHint: true });
  const EXTERNAL_WRITE = classifyTool({ readOnlyHint: false, openWorldHint: true });

  it('lets every personal mode read without an approval interruption', () => {
    for (const mode of ['suggest_only', 'ask_before_acting', 'routine_autonomy'] as const) {
      expect(decideUserOwnedToolExecution('autonomous', mode, READ)).toBe('execute');
    }
  });

  it('turns autonomous workspace writes into suggestions or proposals when the person requires it', () => {
    expect(decideUserOwnedToolExecution('autonomous', 'suggest_only', ROUTINE_WRITE)).toBe(
      'record_only',
    );
    expect(decideUserOwnedToolExecution('autonomous', 'ask_before_acting', ROUTINE_WRITE)).toBe(
      'propose',
    );
  });

  it('executes only safe internal writes under routine autonomy', () => {
    expect(decideUserOwnedToolExecution('autonomous', 'routine_autonomy', ROUTINE_WRITE)).toBe(
      'execute',
    );
    expect(decideUserOwnedToolExecution('autonomous', 'routine_autonomy', DESTRUCTIVE_WRITE)).toBe(
      'propose',
    );
    expect(decideUserOwnedToolExecution('autonomous', 'routine_autonomy', EXTERNAL_WRITE)).toBe(
      'propose',
    );
  });

  it('never lets a personal preference loosen the workspace agent policy', () => {
    expect(decideUserOwnedToolExecution('suggest', 'routine_autonomy', ROUTINE_WRITE)).toBe(
      'record_only',
    );
    expect(
      decideUserOwnedToolExecution('act_with_approval', 'routine_autonomy', ROUTINE_WRITE),
    ).toBe('propose');
  });
});

describe('decideToolExecution', () => {
  const READ: ToolAnnotationHints = { readOnlyHint: true };
  const WRITE: ToolAnnotationHints = { readOnlyHint: false };

  it.each<[string, ToolAnnotationHints, ToolDecision]>([
    ['suggest', READ, 'execute'],
    ['suggest', WRITE, 'record_only'],
    ['act_with_approval', READ, 'execute'],
    ['act_with_approval', WRITE, 'propose'],
    ['autonomous', READ, 'execute'],
    ['autonomous', WRITE, 'execute'],
  ])('policy %s × %o → %s', (policy, hints, expected) => {
    expect(
      decideToolExecution(
        policy as 'suggest' | 'act_with_approval' | 'autonomous',
        classifyTool(hints),
      ),
    ).toBe(expected);
  });

  it('reads always execute — the dial never gates observation, only mutation', () => {
    for (const policy of ['suggest', 'act_with_approval', 'autonomous'] as const) {
      expect(decideToolExecution(policy, classifyTool(READ))).toBe('execute');
    }
  });

  it('an unannotated (fail-closed) tool is gated exactly like a declared write', () => {
    expect(decideToolExecution('act_with_approval', classifyTool(undefined))).toBe('propose');
    expect(decideToolExecution('suggest', classifyTool(undefined))).toBe('record_only');
  });
});
