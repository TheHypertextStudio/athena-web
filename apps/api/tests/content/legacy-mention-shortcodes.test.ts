/**
 * The one-way conversion from the old shortcode mention form to the current link form.
 *
 * @remarks
 * This runs over prose real people already wrote, so the cases that matter are the ones where
 * getting it wrong silently damages a document: a shortcode that is not a mention, a label
 * carrying the characters Markdown gives meaning to, and re-running the conversion over its own
 * output.
 */
import { describe, expect, it } from 'vitest';

import { rewriteLegacyMentions } from '../../src/content/legacy-mention-shortcodes';

const ORG = 'org_1';

describe('rewriteLegacyMentions', () => {
  it('returns prose with no shortcode untouched, byte for byte', () => {
    const prose = 'Nothing to see. A bracket [like this] and a [link](https://example.com).';
    expect(rewriteLegacyMentions(prose, ORG)).toBe(prose);
  });

  it('converts a task reference into a link carrying the same id', () => {
    expect(rewriteLegacyMentions('See [mention kind="task" id="t1" label="Ship it"]', ORG)).toBe(
      'See [Ship it](/orgs/org_1/tasks/t1 "docket:v1:task:t1")',
    );
  });

  it('routes each kind to the path that kind actually lives at', () => {
    expect(
      rewriteLegacyMentions('[mention kind="project" id="p1" label="Rebuild"]', ORG),
    ).toContain('/orgs/org_1/projects/p1');
    expect(rewriteLegacyMentions('[mention kind="cycle" id="c1" label="Q3"]', ORG)).toContain(
      '/orgs/org_1/cycles/c1',
    );
  });

  it('maps the old `person` kind onto the actor vocabulary every other surface uses', () => {
    expect(rewriteLegacyMentions('[mention kind="person" id="m1" label="Ada"]', ORG)).toBe(
      '[Ada](/orgs/org_1/members/m1 "docket:v1:actor:m1")',
    );
  });

  it('converts every shortcode in one body, not just the first', () => {
    const out = rewriteLegacyMentions(
      '[mention kind="task" id="t1" label="A"] then [mention kind="task" id="t2" label="B"]',
      ORG,
    );
    expect(out).toContain('docket:v1:task:t1');
    expect(out).toContain('docket:v1:task:t2');
  });

  it('is idempotent, so a half-finished backfill can simply run again', () => {
    const once = rewriteLegacyMentions('[mention kind="task" id="t1" label="Ship it"]', ORG);
    expect(rewriteLegacyMentions(once, ORG)).toBe(once);
  });

  it('leaves a shortcode naming a kind we cannot route exactly as it was', () => {
    const prose = '[mention kind="unicorn" id="u1" label="Nope"]';
    expect(rewriteLegacyMentions(prose, ORG)).toBe(prose);
  });

  it('leaves a shortcode missing its id alone rather than inventing a target', () => {
    const prose = '[mention kind="task" label="Orphan"]';
    expect(rewriteLegacyMentions(prose, ORG)).toBe(prose);
  });

  it('falls back to the id when there is no label, rather than emitting an empty link', () => {
    expect(rewriteLegacyMentions('[mention kind="task" id="t1"]', ORG)).toBe(
      '[t1](/orgs/org_1/tasks/t1 "docket:v1:task:t1")',
    );
  });

  it('keeps a label containing a bracket from ending the link early', () => {
    const out = rewriteLegacyMentions('[mention kind="task" id="t1" label="Ship [v2]"]', ORG);
    // The label is escaped by the formatter, so the link text survives intact and the href is
    // still reachable — a raw `]` here would truncate the link at the wrong place.
    expect(out).toContain('/orgs/org_1/tasks/t1');
    expect(out).not.toBe('[Ship [v2]](/orgs/org_1/tasks/t1 "docket:v1:task:t1")');
  });

  it('unescapes a quote the writer escaped inside a label', () => {
    expect(
      rewriteLegacyMentions('[mention kind="task" id="t1" label="Say \\"hi\\""]', ORG),
    ).toContain('Say "hi"');
  });
});
