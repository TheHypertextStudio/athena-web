/**
 * `namedWorkDocument` / `taskSearchProjector` — a work object's search-document `summary`, which
 * a mention hovercard, the command palette hint, and the `/search` page snippet all read as a
 * display excerpt.
 *
 * @remarks
 * Regression coverage for the bug where an Initiative/Project/Program/Task's raw Markdown
 * `description` was passed straight through as `summary`, so a preview rendered literal `#`/`*`
 * source instead of plain text.
 */
import { describe, expect, it } from 'vitest';

import {
  initiativeSearchProjector,
  projectSearchProjector,
  programSearchProjector,
  taskSearchProjector,
} from '../../src/search/projectors/work';

const BASE_ROW = {
  id: 'row-1',
  organizationId: 'org-1',
};

describe('initiativeSearchProjector summary (representative of Project/Program via namedWorkDocument)', () => {
  it("prefers the entity's own authored plain-text summary over the description", async () => {
    const doc = await initiativeSearchProjector.project({
      entityId: 'row-1',
      row: {
        ...BASE_ROW,
        name: 'Have a fun, memorable year',
        summary: 'A short authored blurb.',
        description: '# Executive Summary\n\nSome *emphasized* Markdown body.',
      },
    });
    expect(doc?.summary).toBe('A short authored blurb.');
  });

  it('falls back to a Markdown-stripped excerpt of the description when no summary was authored', async () => {
    const doc = await initiativeSearchProjector.project({
      entityId: 'row-1',
      row: {
        ...BASE_ROW,
        name: 'Have a fun, memorable year',
        summary: null,
        description: '# Executive Summary\n\nI will *spark joy* every day.',
      },
    });
    expect(doc?.summary).toBe('Executive Summary I will spark joy every day.');
    expect(doc?.summary).not.toContain('#');
    expect(doc?.summary).not.toContain('*');
  });

  it('treats a blank authored summary the same as a missing one', async () => {
    const doc = await initiativeSearchProjector.project({
      entityId: 'row-1',
      row: {
        ...BASE_ROW,
        name: 'Have a fun, memorable year',
        summary: '   ',
        description: '# Heading only',
      },
    });
    expect(doc?.summary).toBe('Heading only');
  });

  it('keeps the full Markdown body for full-text-search matching regardless of the summary source', async () => {
    const doc = await initiativeSearchProjector.project({
      entityId: 'row-1',
      row: {
        ...BASE_ROW,
        name: 'Have a fun, memorable year',
        summary: 'A short authored blurb.',
        description: '# Executive Summary\n\nSome *emphasized* Markdown body.',
      },
    });
    expect(doc?.body).toBe('# Executive Summary\n\nSome *emphasized* Markdown body.');
  });

  it('has no summary when neither an authored summary nor a description exist', async () => {
    const doc = await initiativeSearchProjector.project({
      entityId: 'row-1',
      row: { ...BASE_ROW, name: 'Untitled', summary: null, description: null },
    });
    expect(doc?.summary).toBeNull();
  });
});

describe('projectSearchProjector / programSearchProjector', () => {
  it('project also strips Markdown from its description-derived summary', async () => {
    const doc = await projectSearchProjector.project({
      entityId: 'row-1',
      row: {
        ...BASE_ROW,
        name: 'Platform rebuild',
        summary: null,
        description: '# Scope\n\nRewrite it.',
      },
    });
    expect(doc?.summary).toBe('Scope Rewrite it.');
  });

  it('program also strips Markdown from its description-derived summary', async () => {
    const doc = await programSearchProjector.project({
      entityId: 'row-1',
      row: { ...BASE_ROW, name: 'Operations', summary: null, description: '# Scope\n\nRun it.' },
    });
    expect(doc?.summary).toBe('Scope Run it.');
  });
});

describe('taskSearchProjector summary', () => {
  it('always derives the summary from the description, since a task has no authored summary column', async () => {
    const doc = await taskSearchProjector.project({
      entityId: 'row-1',
      row: {
        ...BASE_ROW,
        teamId: 'team-1',
        title: 'Fix the timezone bug',
        state: 'todo',
        description: '# Repro\n\nOpen the app in *any* timezone west of UTC.',
      },
    });
    expect(doc?.summary).toBe('Repro Open the app in any timezone west of UTC.');
  });

  it('has no summary when the task has no description', async () => {
    const doc = await taskSearchProjector.project({
      entityId: 'row-1',
      row: {
        ...BASE_ROW,
        teamId: 'team-1',
        title: 'Fix the timezone bug',
        state: 'todo',
        description: null,
      },
    });
    expect(doc?.summary).toBeNull();
  });
});
