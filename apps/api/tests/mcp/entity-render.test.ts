import { describe, expect, it } from 'vitest';

import { entityRenderMeta, entityRenderOf } from '../../src/mcp/apps/entity-render';

describe('entityRenderOf', () => {
  it('renders every authored field an item carries, by path', () => {
    const render = entityRenderOf([
      {
        id: 'p_1',
        description: '# Brief\n\nThe outcome.',
        latestUpdate: { body: 'On schedule.' },
        summary: 'Plain summary stays in the payload.',
      },
    ]);
    const fields = render.items['p_1'];
    expect(Object.keys(fields ?? {})).toEqual(['description', 'latestUpdate.body']);
    expect(fields?.['description']?.blocks).toHaveLength(2);
  });

  it('leaves out items and fields with nothing written', () => {
    expect(
      entityRenderOf([
        { id: 'p_1', description: null },
        { id: 'p_2', body: '  ' },
      ]),
    ).toEqual({
      items: {},
    });
    expect(entityRenderMeta([{ id: 'p_1' }])).toBeUndefined();
  });

  it('keeps only the excerpt for a batch', () => {
    const render = entityRenderOf([
      { id: 'a', description: '# Brief\n\nFirst.' },
      { id: 'b', description: 'Second.' },
    ]);
    expect(render.items['a']?.['description']).toMatchObject({ blocks: [], excerpt: 'First.' });
  });

  it('ignores rows without a string id', () => {
    expect(entityRenderOf([{ description: 'Orphan.' }]).items).toEqual({});
  });

  it('carries a project’s work index even when nothing on it is written', () => {
    const work = { p_1: { tasks: [], total: 0 } };
    expect(entityRenderMeta([{ id: 'p_1' }], work)).toEqual({
      'docket/render': { items: {}, work },
    });
  });

  it('carries the model under the render key', () => {
    expect(Object.keys(entityRenderMeta([{ id: 'a', body: 'Hi.' }]) ?? {})).toEqual([
      'docket/render',
    ]);
  });
});
