import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CORPUS_PATH,
  STRATEGY_RULES,
  readCorpus,
  resolveCorpus,
  scanCorpus,
  scanText,
} from '../../scripts/context-strategy-check';

/**
 * GEN-22: the embrace-extend-extinguish context strategy must not be relitigated in any launch
 * artifact, and the guard that enforces it must be reproducible AND proven to fire.
 *
 * A policy test that only asserts "currently zero findings" is worthless — a regex that matches
 * nothing passes it forever. So the suite injects the requirement's own example sentence into a
 * corpus file and asserts the check goes red, then asserts the real tree is green.
 */
const temporaries: string[] = [];

/** Build a throwaway repo root containing one corpus file with the given text. */
function fixtureRoot(relativePath: string, text: string): string {
  const root = mkdtempSync(join(tmpdir(), 'context-strategy-'));
  temporaries.push(root);
  mkdirSync(join(root, dirname(CORPUS_PATH)), { recursive: true });
  writeFileSync(
    join(root, CORPUS_PATH),
    JSON.stringify({ rationale: 'fixture', include: ['docs/**/*.md'], exclude: [] }),
    'utf8',
  );
  mkdirSync(join(root, dirname(relativePath)), { recursive: true });
  writeFileSync(join(root, relativePath), text, 'utf8');
  return root;
}

afterEach(() => {
  for (const dir of temporaries.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the committed corpus', () => {
  it('resolves to a real, non-trivial file list — the check has something to scan', () => {
    const files = resolveCorpus(readCorpus());
    expect(files.length).toBeGreaterThan(50);
    // The modules that implement context sync are in scope, not just prose.
    expect(files).toContain('packages/integrations/src/notion.ts');
    expect(files).toContain('apps/api/src/routes/integration-reconcile.ts');
    expect(files).toContain('docs/engineering/specs/notion-sync.md');
    expect(files).toContain('docs/migration/sunsama-to-docket.md');
  });

  it('is deterministic — two resolutions of the same tree agree exactly', () => {
    expect(resolveCorpus(readCorpus())).toEqual(resolveCorpus(readCorpus()));
  });

  it('excludes the compliance audit, which quotes the very sentences the rules forbid', () => {
    expect(resolveCorpus(readCorpus())).not.toContain('docs/engineering/launch-compliance.md');
  });
});

describe('the guard fires', () => {
  it('fails on the requirement’s own example sentence', () => {
    const root = fixtureRoot(
      'docs/plan.md',
      '# Plan\n\nwe should make Notion sync read-only for launch\n',
    );
    const findings = scanCorpus(resolveCorpus(readCorpus(root), root), root);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe('propose-read-only-sync');
    expect(findings[0]?.line).toBe(3);
  });

  it.each([
    ['we should make Notion sync read-only for launch', 'propose-read-only-sync'],
    ['The connector should be read-only for now', 'propose-read-only-sync'],
    ['Let’s defer two-way sync until we have more time', 'defer-two-way-sync'],
    ['Write-back can be a post-launch follow-up', 'defer-two-way-sync-post-launch'],
    ['We should use last-write-wins so the newer edit survives', 'external-tool-wins-conflict'],
    ['Docket should not be the source of truth here', 'docket-not-source-of-truth'],
    ['We should rethink embrace, extend, extinguish before shipping', 'abandon-strategy'],
  ])('flags %j under %s', (sentence, ruleId) => {
    const findings = scanText('docs/x.md', sentence);
    expect(findings.map((f) => f.ruleId)).toContain(ruleId);
  });

  it('does NOT flag descriptive prose about a provider that genuinely cannot write', () => {
    // A guard that fires on description gets suppressed, and then it guards nothing.
    for (const line of [
      'Gmail is a read-only mirror because Gmail exposes no task API.',
      'Read-only connectors omit `asWritable` and never push.',
      'The pull-only importItems was insert-or-skip; this module makes it bidirectional.',
      'Both sides changed since the last sync: Docket wins.',
      'A read-only mirror never pushes, so a locally dirty mirrored task yields to the provider.',
    ]) {
      expect(scanText('docs/x.md', line)).toEqual([]);
    }
  });
});

describe('the real tree', () => {
  it('has zero passages relitigating the strategy', () => {
    const findings = scanCorpus(resolveCorpus(readCorpus()));
    expect(findings.map((f) => `${f.file}:${String(f.line)} [${f.ruleId}] ${f.text}`)).toEqual([]);
  });

  it('every rule carries a written rationale, so a finding explains itself', () => {
    for (const rule of STRATEGY_RULES) {
      expect(rule.why.length).toBeGreaterThan(40);
      expect(rule.id).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
