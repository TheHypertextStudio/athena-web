import { describe, expect, it } from 'vitest';

import {
  OBJECT_KINDS,
  type ObjectKind,
  type ObjectRef,
  objectHref,
} from '../../../src/lib/actions/object';
import { objectsToClipboard } from '../../../src/lib/clipboard/object-clipboard';

const ORIGIN = 'https://docket.test';

/** One object reference with sensible defaults. */
function ref(kind: ObjectKind, id: string, title: string): ObjectRef {
  return { kind, id, organizationId: 'org1', title };
}

/**
 * `objectHref` is the single derivation of where an object lives. Every menu's Open, every copied
 * link, and every pasted row goes through it, so a kind missing an answer here is a kind that opens
 * to one URL and copies as another.
 */
describe('objectHref', () => {
  it('addresses every kind that has a detail page', () => {
    expect(objectHref(ref('task', 't1', 'T'))).toBe('/orgs/org1/tasks/t1');
    expect(objectHref(ref('project', 'p1', 'P'))).toBe('/orgs/org1/projects/p1');
    expect(objectHref(ref('initiative', 'i1', 'I'))).toBe('/orgs/org1/initiatives/i1');
    expect(objectHref(ref('program', 'g1', 'G'))).toBe('/orgs/org1/programs/g1');
    expect(objectHref(ref('cycle', 'c1', 'C'))).toBe('/orgs/org1/cycles/c1');
    expect(objectHref(ref('team', 'm1', 'M'))).toBe('/orgs/org1/teams/m1');
  });

  it('has no path for kinds addressed by time rather than by id', () => {
    expect(objectHref(ref('calendar_event', 'e1', 'E'))).toBeNull();
    expect(objectHref(ref('time_block', 'b1', 'B'))).toBeNull();
  });

  it('has no path for an object outside a workspace', () => {
    expect(objectHref({ ...ref('task', 't1', 'T'), organizationId: null })).toBeNull();
  });

  it('answers for every declared kind, so a new kind cannot silently have no answer', () => {
    for (const kind of OBJECT_KINDS) {
      expect(() => objectHref(ref(kind, 'x', 'X'))).not.toThrow();
    }
  });
});

describe('objectsToClipboard', () => {
  it('copies one object as a link rather than a one-item list', () => {
    const payload = objectsToClipboard([ref('task', 't1', 'Fix the login redirect')], ORIGIN);

    expect(payload.text).toBe('[Fix the login redirect](https://docket.test/orgs/org1/tasks/t1)');
    expect(payload.html).toBe(
      '<a href="https://docket.test/orgs/org1/tasks/t1">Fix the login redirect</a>',
    );
  });

  it('copies several objects as a list in both flavors', () => {
    const payload = objectsToClipboard(
      [ref('task', 't1', 'First'), ref('project', 'p1', 'Second')],
      ORIGIN,
    );

    expect(payload.text.split('\n')).toEqual([
      '- [First](https://docket.test/orgs/org1/tasks/t1)',
      '- [Second](https://docket.test/orgs/org1/projects/p1)',
    ]);
    expect(payload.html.startsWith('<ul>')).toBe(true);
    expect(payload.html).toContain('<li><a href="https://docket.test/orgs/org1/tasks/t1">');
  });

  it('keeps a bracketed title readable after a round trip through a Markdown parser', () => {
    const payload = objectsToClipboard([ref('task', 't1', 'Fix [Button] rendering')], ORIGIN);

    // Unescaped, the closing bracket would end the link text and the rest would parse as junk.
    expect(payload.text).toBe(
      '[Fix \\[Button\\] rendering](https://docket.test/orgs/org1/tasks/t1)',
    );
  });

  it('keeps markup-significant characters in a title as text in the rich flavor', () => {
    const payload = objectsToClipboard([ref('task', 't1', 'Ship <Input> & <Select>')], ORIGIN);

    expect(payload.html).toContain('Ship &lt;Input&gt; &amp; &lt;Select&gt;');
  });

  it('falls back to a bare title for an object with nowhere to point', () => {
    const payload = objectsToClipboard([ref('time_block', 'b1', 'Focus block')], ORIGIN);

    expect(payload.text).toBe('Focus block');
    expect(payload.html).toBe('Focus block');
  });

  it('produces nothing to write when there is nothing to copy', () => {
    expect(objectsToClipboard([], ORIGIN)).toEqual({ text: '', html: '' });
  });
});
