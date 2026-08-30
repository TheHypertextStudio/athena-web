/**
 * `@docket/api` — `taskSummary` branch coverage.
 *
 * @remarks
 * `taskSummary` is the fallback that derives a Hub row's one-line summary from a task's Markdown
 * description when no `task.summary` has been written. It is pure (string in, string out, no
 * DB/IO), so it is unit-tested directly here rather than through a route — the same shape
 * `task-helpers.test.ts` already uses for `toOut`/`buildTaskViewFilter` in the sibling file.
 *
 * Every route-level Hub test constructs tasks with short or absent descriptions, so none of them
 * previously exercised the abbreviation guard, the lead-sentence-too-long branch, or the
 * word-boundary-vs-raw-clip branches — each case below isolates exactly one of those decision
 * points.
 */
import { describe, expect, it } from 'vitest';

import { filterViewableHubTasks, taskSummary, toMilestoneItem } from '../../src/routes/hub-helpers';
import type { HubTaskViewFilters } from '../../src/routes/hub-helpers';
import type { ViewableTaskParts } from '../../src/routes/task-helpers';

describe('taskSummary', () => {
  it('returns null for no description', () => {
    expect(taskSummary(null)).toBeNull();
  });

  it('returns null when the description is entirely Markdown noise', () => {
    // A heading names a section rather than stating anything, and the noise pass drops the whole
    // line — nothing prose-like survives to flatten.
    expect(taskSummary('# Just a heading')).toBeNull();
    expect(taskSummary('```\nconst x = 1;\n```')).toBeNull();
  });

  it('returns the lead sentence when it has real length and ends under the cap', () => {
    expect(
      taskSummary('Rebuild the intake form. Then follow up with design about the layout.'),
    ).toBe('Rebuild the intake form.');
  });

  it('does not mistake an abbreviation for a sentence end', () => {
    // "See e.g." matches the sentence-end regex but is only two words. Rejecting matches under
    // four words is what keeps the summary from reading as the abbreviation alone.
    const description = 'See e.g. the linked doc for details on what changed here today.';
    const result = taskSummary(description);
    expect(result).not.toBe('See e.g.');
    expect(result).toBe(description);
  });

  it('rejects a matched lead sentence that is itself over the cap', () => {
    // The captured lead is 144 characters — matched (real sentence-ending punctuation, four-plus
    // words) but too long to return whole, isolating the length gate from the word-count gate.
    const description =
      'Rebuild the whole intake pipeline end to end including validation, retries, downstream ' +
      'notification fanout, the audit logging path, and cleanup. Then verify manually everywhere.';
    const result = taskSummary(description);
    expect(result).not.toBeNull();
    expect(result?.endsWith('…')).toBe(true);
    expect(result?.length).toBeLessThanOrEqual(140);
  });

  it('returns the flattened text as-is when it has no sentence punctuation and fits the cap', () => {
    const description =
      'Update the onboarding copy so it reads clearly for new hires without markdown';
    expect(taskSummary(description)).toBe(description);
  });

  it('clips at a word boundary when one exists past the 60% mark', () => {
    const description = Array.from({ length: 30 }, (_, i) => `word${String(i)}`).join(' ');
    const result = taskSummary(description);
    expect(result).not.toBeNull();
    expect(result?.endsWith('…')).toBe(true);
    const stripped = result?.replace('…', '') ?? '';
    // A clean word boundary exists past the 60% mark, so the cut lands exactly on a space in the
    // source rather than mid-word — the character immediately after the kept prefix is a space.
    expect(description.startsWith(stripped)).toBe(true);
    expect(description[stripped.length]).toBe(' ');
  });

  it('cuts at the raw 140-character mark when no word boundary exists near the cap', () => {
    const description = 'x'.repeat(200);
    const result = taskSummary(description);
    // No spaces anywhere, so `lastSpace` is -1 and the clip falls back to the raw cut.
    expect(result).toBe(`${'x'.repeat(140)}…`);
  });
});

describe('toMilestoneItem', () => {
  it('reports a null target date rather than throwing on a milestone with none set', () => {
    // `targetDate?.toISOString() ?? null` — only the "has a date" side was ever exercised.
    const milestone = { id: 'm1', name: 'Launch', targetDate: null } as Parameters<
      typeof toMilestoneItem
    >[0];
    expect(toMilestoneItem(milestone)).toEqual({ id: 'm1', name: 'Launch', targetDate: null });
  });
});

describe('filterViewableHubTasks', () => {
  const task = (
    id: string,
    organizationId: string,
  ): ViewableTaskParts & { organizationId: string } => ({
    id,
    organizationId,
    teamId: 'team_1',
    projectId: null,
    programId: null,
    visibility: 'public',
  });

  it('keeps a task when its org has a matching predicate and that predicate allows it', () => {
    const filters: HubTaskViewFilters = new Map([['org_a', () => true]]);
    expect(filterViewableHubTasks([task('t1', 'org_a')], filters)).toEqual([task('t1', 'org_a')]);
  });

  it('drops a task from an org with no predicate rather than throwing', () => {
    // `filters.get(task.organizationId)?.(task) ?? false` — the "no filter for this org" branch,
    // reached when a caller's membership scope doesn't cover a task's org, was never exercised.
    const filters: HubTaskViewFilters = new Map([['org_a', () => true]]);
    expect(filterViewableHubTasks([task('t1', 'org_unscoped')], filters)).toEqual([]);
  });
});
