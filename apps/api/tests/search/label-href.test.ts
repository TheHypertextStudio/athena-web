/**
 * `@docket/api` — the label search hit links somewhere that actually filters.
 *
 * @remarks
 * The previous href was `/orgs/:orgId/tasks?labelId=…`, a bespoke param the tasks page never
 * read, so clicking a label in search landed on an unfiltered list. This asserts the href is
 * expressed in the view toolbar's own `filter=field:op:value` codec — the one the page already
 * parses — rather than reintroducing a second, silently-ignored dialect.
 */
import { describe, expect, it } from 'vitest';

import { entityHref } from '../../src/search/routes';

const ORG = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const LABEL = '01ARZ3NDEKTSV4RRFFQ69G5FA1';

describe('label search hit href', () => {
  it('points at the task list with a parseable label filter', () => {
    const href = entityHref(ORG, 'label', LABEL);
    expect(href).toBe(`/orgs/${ORG}/tasks?filter=labels%3Aeq%3A${LABEL}`);
  });

  it('encodes a filter the view codec reads back as the label predicate', () => {
    // Decoding here mirrors what `view-state-url.parse` does on the page: read the `filter`
    // param, split on `:`, and component-decode each part. If either side changes shape, this
    // fails rather than the link quietly doing nothing.
    const href = entityHref(ORG, 'label', LABEL);
    const filter = new URL(href, 'https://docket.test').searchParams.get('filter');
    expect(filter).not.toBeNull();

    const [field, op, value] = (filter ?? '').split(':').map(decodeURIComponent);
    expect(field).toBe('labels');
    expect(op).toBe('eq');
    expect(value).toBe(LABEL);
  });
});
