import '@testing-library/jest-dom/vitest';

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { excerptRow } from '../../../src/components/mentions/mention-hovercard';

afterEach(cleanup);

type EntityCard = NonNullable<Parameters<typeof excerptRow>[1]>;

function entityCard(overrides: Partial<EntityCard> = {}): EntityCard {
  return {
    kind: 'entity',
    entityKind: 'task',
    entityId: 'task-1',
    accessible: true,
    title: 'A task',
    subtitle: null,
    excerptMarkdown: null,
    href: '/tasks/task-1',
    state: null,
    health: null,
    ownerLabel: null,
    dueAt: null,
    updatedAt: null,
    ...overrides,
  };
}

describe('excerptRow', () => {
  it('renders excerptMarkdown through the Markdown renderer when present', () => {
    const { container } = render(
      <>{excerptRow(undefined, entityCard({ excerptMarkdown: 'See *emphasis*.' }))}</>,
    );
    expect(container.querySelector('em')?.textContent).toBe('emphasis');
  });

  it('renders a plain-text subtitle fallback as literal text, not as Markdown', () => {
    // Regression: a subtitle containing literal '#'/'*' characters must not be re-lexed as
    // Markdown syntax just because excerptMarkdown is absent (e.g. an authored summary with no
    // body to derive excerptMarkdown from).
    const { container } = render(
      <>
        {excerptRow(undefined, entityCard({ subtitle: 'Fix the #1 blocker with *no* markdown.' }))}
      </>,
    );
    expect(container.querySelector('em, strong, h1, h2, h3')).toBeNull();
    expect(container.textContent).toBe('Fix the #1 blocker with *no* markdown.');
  });

  it('renders nothing when neither an excerpt, a subtitle, nor a description exists', () => {
    const { container } = render(<>{excerptRow(undefined, entityCard())}</>);
    expect(container.textContent).toBe('');
  });
});
