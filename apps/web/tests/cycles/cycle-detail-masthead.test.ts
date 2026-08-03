/**
 * The cycle detail masthead's one-line summary.
 *
 * @remarks
 * A cycle is the only entity in Docket whose default name is *derived* — an unnamed cycle is titled
 * by its window (`displayName`). That makes the masthead the one place where a subtitle built as
 * "window · runway" can print the very same six words the title already carries, one line apart.
 * The audit saw exactly that (`"Jul 27 – Aug 2"` as the title over `"Jul 27 – Aug 2 · Day 7 of 7 ·
 * last day"`), and at 390px it also cost the runway its readability: the subtitle is a single
 * truncating line, so the duplicated window pushed "last day" out to "…· la…".
 *
 * {@link cycleSubtitle} is the decision, and these are its two branches. Both assertions are about
 * the *relationship* between the title and the subtitle, so each fixes the title it is paired with.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cycleSubtitle } from '../../src/app/(app)/orgs/[orgId]/cycles/[cycleId]/page';

/** The real auto-rolled window the audit screenshotted, verbatim from the dev API. */
const STARTS_AT = '2026-07-27T00:00:00.000Z';
const ENDS_AT = '2026-08-02T23:59:59.999Z';

/**
 * A moment inside {@link STARTS_AT}–{@link ENDS_AT}, so the runway clause is a live one.
 *
 * @remarks
 * The window above is a fixed historical fixture but the runway is computed against the clock, so
 * without pinning `now` these assertions only hold on the day they were written — and they did not
 * survive it: run an hour later, past `endsAt`, every "Day 7 of 7" became "Wrapped · ran 7 days".
 * Pinning is what lets the runway phrasing stay asserted verbatim instead of being loosened to a
 * pattern that would also accept the wrapped copy; the branch under test (does the subtitle repeat
 * the window the title already carries?) is unaffected by the clock either way.
 */
const INSIDE_WINDOW = new Date('2026-08-02T12:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(INSIDE_WINDOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('cycleSubtitle', () => {
  it('states the window once when the title IS the window (an unnamed cycle)', () => {
    // The title an unnamed cycle renders — `CycleOut.displayName`, i.e. `defaultCycleName`.
    const title = 'Jul 27 – Aug 2';
    const subtitle = cycleSubtitle(null, STARTS_AT, ENDS_AT);

    expect(subtitle).not.toContain(title);
    expect(subtitle).toMatch(/^Day \d+ of \d+/);
  });

  it('leads with the window when the title is an author-set name that does not carry it', () => {
    const subtitle = cycleSubtitle('Launch week', STARTS_AT, ENDS_AT);

    expect(subtitle).toContain('Jul 27 – Aug 2');
    expect(subtitle).toContain('Day');
  });

  it('never renders the epoch-anchored auto-roll number', () => {
    for (const name of [null, 'Launch week']) {
      expect(cycleSubtitle(name, STARTS_AT, ENDS_AT)).not.toMatch(/\d{5,}/);
    }
  });
});
