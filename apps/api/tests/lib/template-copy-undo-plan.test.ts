import { describe, expect, it } from 'vitest';
import { planTemplateCopyUndo, type CopyUndoFacts } from '../../src/lib/template-gallery/undo-plan';

const facts = (
  key: string,
  dependencies: string[] = [],
  changes: Partial<CopyUndoFacts> = {},
): CopyUndoFacts => ({
  key,
  dependencies,
  reservationState: 'pending',
  changed: false,
  ...changes,
});
describe('copy bundle retention', () => {
  it('orders independent parents before dependencies without trusting query order', () => {
    expect(planTemplateCopyUndo([facts('child'), facts('parent', ['child'])])).toEqual([
      { entryKey: 'parent', action: 'check_unused' },
      { entryKey: 'child', action: 'check_unused' },
    ]);
  });
  it('leaves dependency retention to current references after each parent is processed', () => {
    expect(
      planTemplateCopyUndo([
        facts('leaf'),
        facts('middle', ['leaf']),
        facts('parent', ['middle'], { changed: true }),
        facts('independent'),
      ]),
    ).toEqual(
      expect.arrayContaining([
        { entryKey: 'parent', action: 'retain_changed' },
        { entryKey: 'middle', action: 'check_unused' },
        { entryKey: 'leaf', action: 'check_unused' },
        { entryKey: 'independent', action: 'check_unused' },
      ]),
    );
  });
  it('archives unchanged publications and rechecks usage only for unchanged private copies', () => {
    expect(
      planTemplateCopyUndo([
        facts('private'),
        facts('published', [], { reservationState: 'consumed' }),
        facts('edited', [], { reservationState: 'consumed', changed: true }),
      ]),
    ).toEqual(
      expect.arrayContaining([
        { entryKey: 'private', action: 'check_unused' },
        { entryKey: 'published', action: 'archive' },
        { entryKey: 'edited', action: 'retain_changed' },
      ]),
    );
  });
  it('refuses unknown, duplicate, cyclic and already void reservation metadata', () => {
    for (const entries of [
      [facts('parent', ['missing'])],
      [facts('a'), facts('a')],
      [facts('a', ['b']), facts('b', ['a'])],
      [facts('void', [], { reservationState: 'void' })],
    ])
      expect(() => planTemplateCopyUndo(entries)).toThrow();
  });
  it('orders both diamond parents before a shared dependency exactly once', () => {
    const result = planTemplateCopyUndo([
      facts('shared'),
      facts('right', ['shared']),
      facts('root', ['left', 'right']),
      facts('left', ['shared']),
    ]);
    expect(result.map((step) => step.entryKey)).toEqual(['root', 'left', 'right', 'shared']);
  });
  it('accepts the 100-definition and 2000-edge limits and refuses either boundary overflow', () => {
    const entries = Array.from({ length: 100 }, (_, index) => facts(`entry_${index}`));
    let remaining = 2000;
    const bounded = entries.map((entry, index) => {
      const dependencies = entries.slice(index + 1, index + 1 + remaining).map((item) => item.key);
      remaining -= dependencies.length;
      return { ...entry, dependencies };
    });
    expect(remaining).toBe(0);
    expect(planTemplateCopyUndo(bounded)).toHaveLength(100);
    expect(() => planTemplateCopyUndo([...entries, facts('extra')])).toThrow();
    bounded[98]?.dependencies.push('entry_99');
    expect(() => planTemplateCopyUndo(bounded)).toThrow();
  });
});
