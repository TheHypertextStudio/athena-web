/**
 * `pnpm check:context-strategy` — guard the embrace-extend-extinguish context strategy against
 * being relitigated in any launch artifact.
 *
 * @remarks
 * The strategy is settled: Docket ingests context from the incumbent tools, adds capability on top
 * of it, and pushes its own state back out so the incumbent can be abandoned — with Docket as the
 * source of truth on conflict. What this tool exists to prevent is not disagreement, it is *drift*:
 * a sentence in a plan doc, a WORKLOG entry, or a code comment that quietly re-opens the decision
 * and is later cited as licence to ship one-way sync.
 *
 * **How it is made reproducible.** The corpus is an enumerated, committed list of glob patterns
 * ({@link CORPUS_PATH}) rather than "whatever happens to be in docs/". A run resolves the globs,
 * prints the resolved file list with the finding count, and exits non-zero on any hit — so two runs
 * on the same tree give the same answer, and adding a document to the launch means adding it to the
 * corpus.
 *
 * **What counts as a violation.** Not the mere mention of a trade-off — plenty of legitimate prose
 * says "read-only mirror" about a provider that genuinely has no write API. A violation is a
 * *proposal*: a sentence that recommends making sync one-way, argues the external tool should win a
 * conflict, or defers two-way sync past launch. Each rule is a phrase pattern with a written
 * rationale, and each is proven to fire by a test that injects the requirement's own example
 * sentence.
 *
 * Usage:
 *
 * ```sh
 * pnpm check:context-strategy          # exits non-zero on any finding
 * pnpm check:context-strategy --list   # print the resolved corpus and stop
 * ```
 */
import { readFileSync, statSync } from 'node:fs';
import { globSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** The repo root, derived from this file's location. */
export const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');

/** Where the committed corpus definition lives. */
export const CORPUS_PATH = 'docs/engineering/context-strategy-corpus.json';

/**
 * One rule: the set of patterns that must ALL appear in a single sentence, plus why that
 * combination is a relitigation rather than a description.
 *
 * @remarks
 * Conjunction-within-a-sentence rather than one long ordered regex, because English does not fix
 * the order ("make sync read-only" and "make it read-only sync" mean the same thing) and an
 * order-sensitive pattern would be trivially evaded by rephrasing.
 */
export interface StrategyRule {
  /** Stable machine id, printed with every finding. */
  readonly id: string;
  /** Every pattern must match the same sentence for the rule to fire. */
  readonly requires: readonly RegExp[];
  /**
   * Any match here suppresses the rule for that sentence.
   *
   * @remarks
   * The escape hatch for prose that is *about* a provider's capabilities rather than a proposal
   * — "existing users with read-only grants keep sync working" is a description of OAuth scope,
   * not an argument for one-way sync. Without this the guard fires on documentation and gets
   * switched off, at which point it guards nothing.
   */
  readonly excludes?: readonly RegExp[];
  /** Why a passage matching this is a relitigation of the settled strategy. */
  readonly why: string;
}

/** The modal/directive verbs that turn a description into a proposal. */
const PROPOSING =
  /\b(?:should|shouldn['’]t|let['’]s|we (?:can|could|will|might|need to|ought to)|make|keep|ship|leave|just)\b/i;

/**
 * Split a line into sentences.
 *
 * @remarks
 * Sentence-scoped matching is what keeps "Gmail is a read-only mirror. We should ship the Notion
 * connector." from reading as a proposal to ship a read-only connector.
 */
export function sentences(line: string): string[] {
  return line
    .split(/(?<=[.!?;])\s+|\s+[—–]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * The rules, one per way the strategy has actually been argued away in practice.
 *
 * @remarks
 * Every pattern requires a *modal or directive* verb near the subject ("should", "let's", "make it",
 * "defer", "punt", "post-launch") precisely so that descriptive prose — "Gmail is a read-only
 * mirror because Gmail has no task API" — does not trip it. A guard that fires on description gets
 * suppressed within a week and then guards nothing.
 */
export const STRATEGY_RULES: readonly StrategyRule[] = [
  {
    id: 'propose-read-only-sync',
    requires: [
      PROPOSING,
      /\b(?:read[- ]only|one[- ]way)\b/i,
      /\b(?:sync|syncing|synchroni[sz]ation|integration|connector)\b/i,
    ],
    // "read-only grant/scope/token/API" describes what a provider allows; it is not a proposal
    // about Docket's sync direction.
    excludes: [/\b(?:grant|grants|scope|scopes|token|permission|credential|api|endpoint)\b/i],
    why: 'Proposes shipping a one-way sync. Two-way sync is what lets Docket supersede the source tool; without it the incumbent can never be abandoned.',
  },
  {
    id: 'defer-two-way-sync',
    requires: [
      /\b(?:defer|deferred|postpone|punt|push out|drop|cut|descope|de-scope)\b/i,
      /\b(?:two[- ]way|bidirectional|write[- ]back|writeback)\b/i,
    ],
    why: 'Defers two-way sync past launch. The launch scope explicitly forbids deferring, partially shipping, or following up on any part of this strategy.',
  },
  {
    id: 'defer-two-way-sync-post-launch',
    requires: [
      /\b(?:two[- ]way|bidirectional|write[- ]back|writeback)\b/i,
      /\b(?:post[- ]launch|after launch|v2|later release|follow[- ]?up|next milestone)\b/i,
    ],
    why: 'Schedules two-way sync for after launch. Every requirement in this launch must ship in it; a connector that only reads cannot let the incumbent tool be retired.',
  },
  {
    id: 'external-tool-wins-conflict',
    requires: [
      PROPOSING,
      /\b(?:last[- ]write[- ]wins|newer (?:edit|timestamp|value|side) wins|(?:notion|linear|github|gmail|sunsama|the (?:source|external|incumbent) tool) wins)\b/i,
    ],
    why: 'Argues the external tool settles a conflict. Docket is the source of truth on conflict; anything else means work can still be overwritten from outside Docket.',
  },
  {
    id: 'docket-not-source-of-truth',
    requires: [
      /\bdocket\b/i,
      /\b(?:should not|shouldn['’]t|need not|does ?n['’]?o?t need to)\s+be\s+the\s+source\s+of\s+truth\b/i,
    ],
    why: 'Argues Docket should not hold the source of truth, which is the premise the whole strategy rests on.',
  },
  {
    id: 'abandon-strategy',
    requires: [
      /\b(?:drop|abandon|rethink|reconsider|replace|walk back|revisit)\b/i,
      /\bembrace[,\s-]+extend[,\s-]+extinguish\b/i,
    ],
    why: 'Proposes replacing the embrace-extend-extinguish approach outright, which the launch scope declares non-negotiable.',
  },
];

/** The committed corpus definition. */
export interface CorpusDefinition {
  /** Why this list is the corpus. */
  readonly rationale: string;
  /** Glob patterns, relative to the repo root. */
  readonly include: readonly string[];
  /** Glob patterns excluded from the above. */
  readonly exclude: readonly string[];
}

/** One passage that relitigates the strategy. */
export interface StrategyFinding {
  /** Repo-relative file path. */
  readonly file: string;
  /** 1-indexed line number. */
  readonly line: number;
  /** The rule that fired. */
  readonly ruleId: string;
  /** Why it is a violation. */
  readonly why: string;
  /** The offending line, trimmed. */
  readonly text: string;
}

/** Read the committed corpus definition. */
export function readCorpus(root: string = REPO_ROOT): CorpusDefinition {
  return JSON.parse(readFileSync(resolve(root, CORPUS_PATH), 'utf8')) as CorpusDefinition;
}

/**
 * Resolve the corpus globs to a sorted, de-duplicated list of repo-relative file paths.
 *
 * @param corpus - The committed definition.
 * @param root - The repo root to resolve against.
 */
export function resolveCorpus(corpus: CorpusDefinition, root: string = REPO_ROOT): string[] {
  const excluded = new Set<string>();
  for (const pattern of corpus.exclude) {
    for (const hit of globSync(pattern, { cwd: root })) excluded.add(hit);
  }
  const files = new Set<string>();
  for (const pattern of corpus.include) {
    for (const hit of globSync(pattern, { cwd: root })) {
      if (excluded.has(hit)) continue;
      try {
        if (!statSync(resolve(root, hit)).isFile()) continue;
      } catch {
        continue;
      }
      files.add(hit);
    }
  }
  return [...files].sort();
}

/**
 * Scan one file's text for relitigating passages.
 *
 * @param file - Repo-relative path, echoed onto each finding.
 * @param text - The file's contents.
 */
export function scanText(file: string, text: string): StrategyFinding[] {
  const findings: StrategyFinding[] = [];
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    for (const sentence of sentences(line)) {
      for (const rule of STRATEGY_RULES) {
        if (!rule.requires.every((pattern) => pattern.test(sentence))) continue;
        if (rule.excludes?.some((pattern) => pattern.test(sentence)) === true) continue;
        findings.push({
          file,
          line: index + 1,
          ruleId: rule.id,
          why: rule.why,
          text: sentence.slice(0, 200),
        });
      }
    }
  }
  return findings;
}

/**
 * Scan the whole resolved corpus.
 *
 * @param files - Repo-relative paths.
 * @param root - The repo root to read from.
 */
export function scanCorpus(files: readonly string[], root: string = REPO_ROOT): StrategyFinding[] {
  const findings: StrategyFinding[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(resolve(root, file), 'utf8');
    } catch {
      continue;
    }
    findings.push(...scanText(file, text));
  }
  return findings;
}

/** Render findings as one line each. */
export function formatFindings(findings: readonly StrategyFinding[]): string {
  return findings
    .map((f) => `${f.file}:${String(f.line)}  [${f.ruleId}]  ${f.text}\n    ${f.why}`)
    .join('\n');
}

/* v8 ignore start -- CLI entrypoint */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const corpus = readCorpus();
  const files = resolveCorpus(corpus);
  if (process.argv.includes('--list')) {
    for (const file of files) console.log(file);
    console.log(`\n${String(files.length)} files in the corpus (${CORPUS_PATH}).`);
  } else {
    const findings = scanCorpus(files);
    console.log(
      `context-strategy: scanned ${String(files.length)} corpus files, ${String(findings.length)} finding(s).`,
    );
    if (findings.length > 0) {
      console.error(`\n${formatFindings(findings)}`);
      console.error(
        '\nThe embrace-extend-extinguish context strategy is settled and must not be relitigated in a launch artifact.',
      );
      process.exitCode = 1;
    }
  }
}
/* v8 ignore stop */

/** Relative path helper used by the test harness. */
export function repoRelative(absolute: string): string {
  return relative(REPO_ROOT, absolute);
}
