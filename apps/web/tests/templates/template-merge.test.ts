/** The template domain's data-preserving merge policy. */
import { describe, expect, it } from 'vitest';

import { templateMerge } from '../../src/components/templates/merge';

interface Draft {
  name: string;
  summary: string;
  description: string;
  priority: 'none' | 'high';
  health: 'on_track' | null;
}

const EMPTY: Draft = {
  name: '',
  summary: '',
  description: '',
  priority: 'none',
  health: null,
};

/** How an initiative-shaped value absorbs a template. */
const RULE = { document: 'description', labels: ['name', 'summary'] } as const;

describe('templateMerge', () => {
  it('uses the template body when the draft has none', () => {
    expect(templateMerge(EMPTY, { description: '## Steps' }, RULE)).toEqual({
      description: '## Steps',
    });
  });

  it('appends to a body the author already typed, rather than replacing it', () => {
    const typed: Draft = { ...EMPTY, description: 'notes I typed myself' };

    expect(templateMerge(typed, { description: '## Steps' }, RULE)).toEqual({
      description: 'notes I typed myself\n\n## Steps',
    });
  });

  it('stacks a second template under the first', () => {
    const once: Draft = { ...EMPTY, description: '## Steps' };

    expect(templateMerge(once, { description: '## Question' }, RULE)).toEqual({
      description: '## Steps\n\n## Question',
    });
  });

  it('preserves leading indentation when appending to an authored code block', () => {
    const typed: Draft = { ...EMPTY, description: '    const answer = 42' };

    expect(templateMerge(typed, { description: '## Steps' }, RULE)).toEqual({
      description: '    const answer = 42\n\n## Steps',
    });
  });

  it('preserves trailing spaces that encode a Markdown hard break', () => {
    const typed: Draft = { ...EMPTY, description: 'First line  ' };

    expect(templateMerge(typed, { description: '## Steps' }, RULE)).toEqual({
      description: 'First line  \n\n## Steps',
    });
  });

  it('treats a whitespace-only body as empty rather than appending to nothing', () => {
    const blank: Draft = { ...EMPTY, description: '   \n  ' };

    expect(templateMerge(blank, { description: '## Steps' }, RULE)).toEqual({
      description: '## Steps',
    });
  });

  it('fills a blank title but never overwrites one', () => {
    expect(templateMerge(EMPTY, { name: 'Bug: ' }, RULE)).toEqual({ name: 'Bug: ' });

    const named: Draft = { ...EMPTY, name: 'Checkout is broken' };
    expect(templateMerge(named, { name: 'Bug: ' }, RULE)).toEqual({});
  });

  it('sets properties outright, since the strip shows them and nothing written is at risk', () => {
    const chosen: Draft = { ...EMPTY, priority: 'none' };

    expect(templateMerge(chosen, { priority: 'high', health: 'on_track' }, RULE)).toEqual({
      priority: 'high',
      health: 'on_track',
    });
  });

  it('asserts only the fields the template names', () => {
    const filled: Draft = { ...EMPTY, priority: 'high', summary: 'mine' };

    expect(templateMerge(filled, { description: '## Steps' }, RULE)).toEqual({
      description: '## Steps',
    });
  });

  it('never removes anything the author wrote', () => {
    const authored: Draft = {
      name: 'Checkout is broken',
      summary: 'Customers cannot pay',
      description: 'It started on Tuesday.',
      priority: 'high',
      health: 'on_track',
    };

    const merged = {
      ...authored,
      ...templateMerge(
        authored,
        { name: 'Bug: ', summary: 'One line', description: '## Steps' },
        RULE,
      ),
    };

    expect(merged.name).toBe('Checkout is broken');
    expect(merged.summary).toBe('Customers cannot pay');
    expect(merged.description).toContain('It started on Tuesday.');
  });
});
