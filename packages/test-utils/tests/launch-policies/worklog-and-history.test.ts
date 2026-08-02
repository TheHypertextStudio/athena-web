import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WORKSPACE_ROOT } from '../workspace';
import { loadLaunchRecord } from './launch-record-schema';

const WORKLOG_RELATIVE_PATH = 'docs/WORKLOG.md';

/** Count non-overlapping occurrences of a literal needle. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Run git in the workspace and return its trimmed stdout. */
function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: WORKSPACE_ROOT, encoding: 'utf8' }).trim();
}

describe('launch worklog and history policy', () => {
  const record = loadLaunchRecord();
  const closed = record.entries.filter((entry) => entry.state === 'closed');
  const worklog = readFileSync(resolve(WORKSPACE_ROOT, WORKLOG_RELATIVE_PATH), 'utf8');

  it('has exactly one worklog entry claiming each closed requirement', () => {
    const violations: string[] = [];
    for (const entry of closed) {
      const anchor = entry.worklogAnchor.trim();
      if (anchor === '') {
        violations.push(`${entry.id} is closed with no worklogAnchor`);
        continue;
      }
      const occurrences = countOccurrences(worklog, anchor);
      if (occurrences !== 1) {
        violations.push(
          `${entry.id} anchor "${anchor}" occurs ${occurrences} times in ${WORKLOG_RELATIVE_PATH} (expected exactly 1)`,
        );
      }
    }
    expect(
      violations,
      `MISS-07: every shipped slice is recorded in ${WORKLOG_RELATIVE_PATH}.\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('never lets two worklog entries claim the same requirement', () => {
    const byAnchor = new Map<string, string[]>();
    for (const entry of closed) {
      const anchor = entry.worklogAnchor.trim();
      byAnchor.set(anchor, [...(byAnchor.get(anchor) ?? []), entry.id]);
    }
    const anchorsById = new Map<string, string[]>();
    for (const [anchor, ids] of byAnchor) {
      for (const id of ids) {
        anchorsById.set(id, [...(anchorsById.get(id) ?? []), anchor]);
      }
    }
    const violations = [...anchorsById.entries()]
      .filter(([, anchors]) => anchors.length !== 1)
      .map(
        ([id, anchors]) =>
          `${id} is claimed by ${anchors.length} worklog entries: ${anchors.join(' | ')}`,
      );
    expect(
      violations,
      `MISS-07: a slice may close several requirements, but each requirement belongs to exactly one slice.\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps the branch history linear', () => {
    const base = git('merge-base', 'main', 'HEAD');
    const merges = git('rev-list', '--merges', '--count', `${base}..HEAD`);
    expect(merges, 'MISS-07: rebase or cherry-pick onto main; never merge into it').toBe('0');
  });
});
