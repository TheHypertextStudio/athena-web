import { describe, expect, it } from 'vitest';

import { athenaSuggestions } from '../../src/lib/athena/suggestions';

describe('athenaSuggestions', () => {
  it('offers three prompts for a project', () => {
    const prompts = athenaSuggestions({
      workspaceId: 'ws_1',
      source: { type: 'project', id: 'p1', label: 'Fall fundraiser launch' },
    });
    expect(prompts).toHaveLength(3);
    expect(new Set(prompts).size).toBe(3);
  });

  it('offers different prompts for a task than for a project', () => {
    const project = athenaSuggestions({
      workspaceId: 'ws_1',
      source: { type: 'project', id: 'p1' },
    });
    const task = athenaSuggestions({ workspaceId: 'ws_1', source: { type: 'task', id: 't1' } });
    expect(task).not.toEqual(project);
    expect(task).toHaveLength(3);
  });

  it('offers day-level prompts without a page', () => {
    expect(athenaSuggestions(null)).toHaveLength(3);
    expect(athenaSuggestions({ workspaceId: 'ws_1' })).toEqual(athenaSuggestions(null));
  });
});
