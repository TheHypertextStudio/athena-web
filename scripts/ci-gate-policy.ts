/**
 * CI gate policy checker — proves that a failing test can never yield a green
 * pipeline or an executed production deploy.
 *
 * @remarks
 * This module exists because two properties are otherwise unenforceable by review alone:
 *
 * - **No ungated check job** — `deploy-production.needs` must name *every* job that executes
 *   tests or checks. The list is correct today, but nothing stops a future job
 *   from being added to `ci.yml` without being wired into `needs`; such a job
 *   would run, fail, and the deploy would ship anyway.
 * - **No soft-failed gate** — no *gating* step may be soft-failed. A `continue-on-error: true`,
 *   a trailing `|| true`, or an `if: always()` on a check step silently converts a
 *   red test into a green run.
 *
 * The checker parses `.github/workflows/*.yml` directly rather than trusting a
 * hand-maintained list, so the workflow file itself remains the single source of
 * truth. It ships its own narrow YAML reader ({@link parseYaml}) because the repo
 * intentionally carries no YAML parser in its dependency tree and this gate must
 * not add one.
 *
 * @example
 * ```bash
 * pnpm ci:gate-policy          # exits non-zero when any rule is violated
 * ```
 *
 * @see {@link checkGatePolicy} for the rule engine
 * @see {@link parseWorkflow} for the workflow projection
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/* -------------------------------------------------------------------------- */
/*  Narrow YAML reader                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The value shapes {@link parseYaml} can produce.
 *
 * @remarks
 * Deliberately narrow: GitHub Actions workflows only ever need scalars, block
 * mappings, block sequences, flow collections, and block scalars. Anchors,
 * aliases, tags, multi-document streams, and complex keys are unsupported and
 * throw rather than parse incorrectly — a silent misparse here would weaken the
 * very gate this module implements.
 */
export type YamlValue =
  | string
  | number
  | boolean
  | null
  | YamlValue[]
  | { [key: string]: YamlValue };

/** A physical line of a YAML document, retained verbatim. */
interface YamlLine {
  /** Number of leading spaces. */
  readonly indent: number;
  /** The line with its leading indentation removed and trailing whitespace trimmed. */
  readonly body: string;
  /** 1-based line number in the source document, for error messages. */
  readonly lineNumber: number;
}

/**
 * Strips a trailing `#` comment from a YAML scalar/structural line.
 *
 * @remarks
 * A `#` only opens a comment when it is at the start of the content or preceded
 * by whitespace, and when it is not inside a quoted scalar. `run: echo "a # b"`
 * and `key: url#fragment` therefore survive untouched. Block-scalar bodies never
 * pass through this function — they are consumed verbatim.
 *
 * @param body - Line content with indentation already removed
 * @returns The line content with any comment removed and trailing space trimmed
 */
function stripComment(body: string): string {
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < body.length; i += 1) {
    const char = body.charAt(i);
    if (quote === '"') {
      if (char === '\\') {
        i += 1;
        continue;
      }
      if (char === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#' && (i === 0 || /\s/.test(body.charAt(i - 1)))) {
      return body.slice(0, i).trimEnd();
    }
  }
  return body.trimEnd();
}

/**
 * Reads a line by index.
 *
 * @remarks
 * `noUncheckedIndexedAccess` makes every array index optional. Every call site here
 * has already bounded its index, so the miss branch is a programming error rather
 * than a document-shape error — it throws with the index instead of being asserted
 * away, so a future refactor that breaks a bound fails loudly.
 *
 * @param lines - The document
 * @param index - Index to read
 * @returns The line at `index`
 * @throws {Error} When `index` is out of range
 */
function lineAt(lines: readonly YamlLine[], index: number): YamlLine {
  const line = lines[index];
  if (line === undefined) throw new Error(`ci-gate-policy: no YAML line at index ${index}`);
  return line;
}

/** Whether a line carries no structural content (blank, or comment-only). */
function isIgnorable(line: YamlLine): boolean {
  return stripComment(line.body).length === 0;
}

/**
 * Unescapes a double-quoted YAML scalar.
 *
 * @param raw - The scalar including its surrounding double quotes
 * @returns The unescaped string value
 */
function unescapeDoubleQuoted(raw: string): string {
  const inner = raw.slice(1, -1);
  let out = '';
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner.charAt(i);
    if (char !== '\\') {
      out += char;
      continue;
    }
    const next = inner.charAt(i + 1);
    i += 1;
    switch (next) {
      case 'n':
        out += '\n';
        break;
      case 't':
        out += '\t';
        break;
      case 'r':
        out += '\r';
        break;
      case '0':
        out += '\0';
        break;
      case '"':
        out += '"';
        break;
      case '\\':
        out += '\\';
        break;
      default:
        out += next;
    }
  }
  return out;
}

/**
 * Splits a flow collection body (`[…]` / `{…}` contents) on top-level commas.
 *
 * @param body - The text between the brackets/braces
 * @returns One entry per comma-separated element, each trimmed
 */
function splitFlowEntries(body: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let current = '';
  for (let i = 0; i < body.length; i += 1) {
    const char = body.charAt(i);
    if (quote) {
      current += char;
      if (quote === '"' && char === '\\') {
        current += body.charAt(i + 1);
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '[' || char === '{') depth += 1;
    if (char === ']' || char === '}') depth -= 1;
    if (char === ',' && depth === 0) {
      entries.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim().length > 0) entries.push(current.trim());
  return entries;
}

/**
 * Splits `key: value` on the key/value separator, honouring quoted keys.
 *
 * @param body - A comment-stripped mapping line
 * @returns The key and the raw remainder, or `null` when the line is not a mapping entry
 */
function splitMappingEntry(body: string): { key: string; rest: string } | null {
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < body.length; i += 1) {
    const char = body.charAt(i);
    if (quote) {
      if (quote === '"' && char === '\\') {
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '[' || char === '{') return null;
    if (char !== ':') continue;
    if (i + 1 < body.length && body.charAt(i + 1) !== ' ') continue;
    const rawKey = body.slice(0, i).trim();
    if (rawKey.length === 0) return null;
    return { key: parseScalarText(rawKey) as string, rest: body.slice(i + 1).trim() };
  }
  return null;
}

/**
 * Parses a single YAML scalar (quoted, flow collection, boolean, number, null, or plain).
 *
 * @param text - The trimmed scalar text
 * @returns The decoded value
 */
function parseScalarText(text: string): YamlValue {
  if (text.length === 0) return null;
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2)
    return unescapeDoubleQuoted(text);
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) {
    return text.slice(1, -1).replaceAll("''", "'");
  }
  if (text.startsWith('[') && text.endsWith(']')) {
    return splitFlowEntries(text.slice(1, -1)).map((entry) => parseScalarText(entry));
  }
  if (text.startsWith('{') && text.endsWith('}')) {
    const map: Record<string, YamlValue> = {};
    for (const entry of splitFlowEntries(text.slice(1, -1))) {
      const split = splitMappingEntry(entry) ?? splitMappingEntry(`${entry} `);
      if (!split) continue;
      map[split.key] = parseScalarText(split.rest);
    }
    return map;
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null' || text === '~') return null;
  if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10);
  if (/^-?\d+\.\d+$/.test(text)) return Number.parseFloat(text);
  return text;
}

/** Index of the first line at or after `from` (and before `to`) that carries content. */
function nextContentLine(lines: readonly YamlLine[], from: number, to: number): number {
  for (let i = from; i < to; i += 1) {
    if (!isIgnorable(lineAt(lines, i))) return i;
  }
  return to;
}

/**
 * Reads a block scalar (`|`, `>`, and their chomping variants) starting at `from`.
 *
 * @param lines - The whole document
 * @param from - Index of the first candidate body line
 * @param to - Exclusive end of the enclosing block
 * @param parentIndent - Indentation of the key that introduced the block scalar
 * @param header - The block-scalar header (`|`, `|-`, `>`, `>+`, …)
 * @returns The decoded string and the index just past the block body
 */
function readBlockScalar(
  lines: readonly YamlLine[],
  from: number,
  to: number,
  parentIndent: number,
  header: string,
): { value: string; next: number } {
  const folded = header.startsWith('>');
  const chomp = header.includes('-') ? 'strip' : header.includes('+') ? 'keep' : 'clip';

  let end = from;
  let bodyIndent = Number.POSITIVE_INFINITY;
  for (let i = from; i < to; i += 1) {
    const line = lineAt(lines, i);
    if (line.body.length === 0) {
      end = i + 1;
      continue;
    }
    if (line.indent <= parentIndent) break;
    bodyIndent = Math.min(bodyIndent, line.indent);
    end = i + 1;
  }
  // Trailing blank lines that are not followed by more body belong to the next node.
  while (end > from && lineAt(lines, end - 1).body.length === 0) end -= 1;
  if (end === from) return { value: '', next: from };

  const indent = Number.isFinite(bodyIndent) ? bodyIndent : parentIndent + 1;
  const raw = lines
    .slice(from, end)
    .map((line) =>
      line.body.length === 0 ? '' : ' '.repeat(Math.max(0, line.indent - indent)) + line.body,
    );

  let value: string;
  if (folded) {
    const parts: string[] = [];
    for (const line of raw) {
      if (line.length === 0) {
        parts.push('\n');
        continue;
      }
      parts.push(parts.length === 0 || parts.at(-1) === '\n' ? line : ` ${line}`);
    }
    value = parts.join('');
  } else {
    value = raw.join('\n');
  }
  if (chomp === 'strip') value = value.replace(/\n+$/, '');
  else if (chomp === 'clip') value = `${value.replace(/\n+$/, '')}\n`;
  else value = `${value}\n`;

  return { value, next: end };
}

/**
 * Parses the block spanning `[from, to)` at the given indentation.
 *
 * @param lines - The whole document
 * @param from - Inclusive start index
 * @param to - Exclusive end index
 * @param indent - Indentation shared by the block's entries
 * @returns The decoded mapping, sequence, or scalar
 */
function parseBlock(
  lines: readonly YamlLine[],
  from: number,
  to: number,
  indent: number,
): YamlValue {
  const first = nextContentLine(lines, from, to);
  if (first >= to) return null;
  const head = stripComment(lineAt(lines, first).body);
  if (head === '-' || head.startsWith('- ')) return parseSequence(lines, first, to, indent);
  if (splitMappingEntry(head) !== null) return parseMapping(lines, first, to, indent);
  // A bare scalar block: a sequence item like `- opened`, or a plain multi-line scalar,
  // which YAML folds onto one line.
  const text = lines
    .slice(first, to)
    .filter((line) => !isIgnorable(line))
    .map((line) => stripComment(line.body))
    .join(' ');
  return parseScalarText(text);
}

/** Exclusive end index of the child block owned by the entry starting at `start`. */
function childBlockEnd(
  lines: readonly YamlLine[],
  start: number,
  to: number,
  indent: number,
): number {
  let end = start;
  for (let i = start; i < to; i += 1) {
    const line = lineAt(lines, i);
    if (isIgnorable(line)) {
      end = i + 1;
      continue;
    }
    if (line.indent <= indent) break;
    end = i + 1;
  }
  return end;
}

/** Parses a block mapping whose entries sit at `indent`. */
function parseMapping(
  lines: readonly YamlLine[],
  from: number,
  to: number,
  indent: number,
): YamlValue {
  const map: Record<string, YamlValue> = {};
  let i = from;
  while (i < to) {
    const line = lineAt(lines, i);
    if (isIgnorable(line)) {
      i += 1;
      continue;
    }
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new Error(`Unexpected indentation at line ${line.lineNumber}: ${line.body}`);
    }
    const body = stripComment(line.body);
    const entry = splitMappingEntry(body);
    if (!entry) {
      throw new Error(`Expected "key: value" at line ${line.lineNumber}: ${body}`);
    }
    const end = childBlockEnd(lines, i + 1, to, indent);
    if (/^[|>][-+]?$/.test(entry.rest)) {
      const block = readBlockScalar(lines, i + 1, end, indent, entry.rest);
      map[entry.key] = block.value;
    } else if (entry.rest.length === 0) {
      map[entry.key] =
        end > i + 1 ? parseBlock(lines, i + 1, end, childIndent(lines, i + 1, end, indent)) : null;
    } else {
      // An inline value that is nonetheless followed by more-indented lines is either a
      // multi-line plain scalar (which every workflow in this repo writes as a block scalar
      // instead) or a typo. Both are rejected: silently swallowing those lines would let a
      // soft-failed step hide from this gate inside a misparsed node.
      if (nextContentLine(lines, i + 1, end) < end) {
        throw new Error(
          `Unexpected indentation at line ${lineAt(lines, nextContentLine(lines, i + 1, end)).lineNumber}: ` +
            `"${entry.key}" already has an inline value. Use a block scalar (| or >) for multi-line values.`,
        );
      }
      map[entry.key] = parseScalarText(entry.rest);
    }
    i = end;
  }
  return map;
}

/** Indentation of the first content line in `[from, to)`, defaulting to `indent + 2`. */
function childIndent(lines: readonly YamlLine[], from: number, to: number, indent: number): number {
  const first = nextContentLine(lines, from, to);
  return first < to ? lineAt(lines, first).indent : indent + 2;
}

/** Parses a block sequence whose `-` markers sit at `indent`. */
function parseSequence(
  lines: readonly YamlLine[],
  from: number,
  to: number,
  indent: number,
): YamlValue {
  const items: YamlValue[] = [];
  let i = from;
  while (i < to) {
    const line = lineAt(lines, i);
    if (isIgnorable(line)) {
      i += 1;
      continue;
    }
    if (line.indent < indent) break;
    const body = stripComment(line.body);
    if (!(body === '-' || body.startsWith('- '))) {
      throw new Error(`Expected a sequence item at line ${line.lineNumber}: ${body}`);
    }
    const end = childBlockEnd(lines, i + 1, to, indent);
    const rest = body.slice(1).trim();
    if (rest.length === 0) {
      items.push(
        end > i + 1 ? parseBlock(lines, i + 1, end, childIndent(lines, i + 1, end, indent)) : null,
      );
      i = end;
      continue;
    }
    const inlineIndent = line.indent + (body.length - body.slice(1).trimStart().length);
    const inline: YamlLine = { indent: inlineIndent, body: rest, lineNumber: line.lineNumber };
    const merged = [inline, ...lines.slice(i + 1, end)];
    items.push(parseBlock(merged, 0, merged.length, inlineIndent));
    i = end;
  }
  return items;
}

/**
 * Parses a single-document YAML string into plain JavaScript values.
 *
 * @remarks
 * Supports exactly the subset GitHub Actions workflows use: block mappings, block
 * sequences, block scalars with chomping indicators, flow sequences/mappings,
 * quoted and plain scalars, and comments. Anything outside that subset raises,
 * which is the safe failure mode for a gate: an unreadable workflow is reported
 * rather than silently passed.
 *
 * @param source - The YAML document text
 * @returns The decoded document
 * @throws {Error} When the document uses unsupported syntax or inconsistent indentation
 */
export function parseYaml(source: string): YamlValue {
  const lines: YamlLine[] = source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((raw, index) => {
      const trimmedEnd = raw.trimEnd();
      const indent = trimmedEnd.length - trimmedEnd.trimStart().length;
      return { indent, body: trimmedEnd.slice(indent), lineNumber: index + 1 };
    });
  const first = nextContentLine(lines, 0, lines.length);
  if (first >= lines.length) return null;
  return parseBlock(lines, 0, lines.length, lineAt(lines, first).indent);
}

/* -------------------------------------------------------------------------- */
/*  Workflow projection                                                       */
/* -------------------------------------------------------------------------- */

/** A single step within a workflow job, projected to the fields this gate reasons about. */
export interface WorkflowStep {
  /** The step's `name`, or its `uses`/`run` head when unnamed. */
  readonly label: string;
  /** The `uses:` action reference, when the step is an action invocation. */
  readonly uses: string | null;
  /** The `run:` script body, when the step is a shell step. */
  readonly run: string | null;
  /** The step's `if:` condition expression, verbatim. */
  readonly condition: string | null;
  /** Whether the step declares `continue-on-error: true`. */
  readonly continueOnError: boolean;
  /** The step's `env:` mapping, with non-string values dropped. */
  readonly env: Readonly<Record<string, string>>;
  /**
   * The step's `with:` inputs, as parsed scalars.
   *
   * @remarks
   * Values keep their YAML type — `fetch-depth: 0` reads back as the number `0`, not `'0'` —
   * because the properties worth asserting on an action step are numeric or boolean far more
   * often than they are textual.
   */
  readonly with: Readonly<Record<string, YamlValue>>;
}

/** A workflow job, projected to the fields this gate reasons about. */
export interface WorkflowJob {
  /** The job's key in `jobs:` — the identifier `needs:` refers to. */
  readonly id: string;
  /** The job's display `name`, when declared. */
  readonly name: string | null;
  /** Job identifiers listed in `needs:`, normalized to an array. */
  readonly needs: readonly string[];
  /** The job's steps, in declaration order. Empty for reusable-workflow calls. */
  readonly steps: readonly WorkflowStep[];
  /** Whether the job declares `continue-on-error: true` at job level. */
  readonly continueOnError: boolean;
  /** The `uses:` reference when the job calls a reusable workflow. */
  readonly uses: string | null;
}

/** A parsed workflow file. */
export interface Workflow {
  /** Repository-relative path of the workflow file. */
  readonly path: string;
  /** The workflow's `name`, when declared. */
  readonly name: string | null;
  /** Whether the workflow header declares its checks intentionally advisory. */
  readonly advisory: boolean;
  /** The workflow's jobs, in declaration order. */
  readonly jobs: readonly WorkflowJob[];
}

/**
 * A source directive that declares a check workflow intentionally non-gating.
 *
 * @remarks
 * This must appear in the leading comment header, before the workflow's YAML
 * content. Keeping it outside the workflow name preserves GitHub's existing
 * check context while still making the exception visible and enforceable.
 */
export const ADVISORY_WORKFLOW_MARKER = '# ci-gate-policy: advisory';

/** Whether a workflow source has the advisory directive in its leading comment header. */
function hasAdvisoryWorkflowMarker(source: string): boolean {
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === ADVISORY_WORKFLOW_MARKER) return true;
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    return false;
  }
  return false;
}

/**
 * First line of a shell script body, used as a step's fallback label.
 *
 * @param run - The step's `run` body
 * @returns The first line, trimmed; the whole body when it is single-line
 */
function firstLine(run: string): string {
  const newline = run.indexOf('\n');
  return (newline === -1 ? run : run.slice(0, newline)).trim();
}

/** Narrows an unknown YAML value to a mapping. */
function asRecord(value: YamlValue): Record<string, YamlValue> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
}

/** Narrows an unknown YAML value to a string, or `null` when it is anything else. */
function asString(value: YamlValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

/** Reads a value that YAML may express as either a scalar or a sequence into a string array. */
function asStringList(value: YamlValue | undefined): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return typeof value === 'string' ? [value] : [];
}

/**
 * Projects a parsed workflow document into the {@link Workflow} shape.
 *
 * @param path - Repository-relative path, used in findings
 * @param source - The workflow file contents
 * @returns The projected workflow
 * @throws {Error} When the document has no `jobs:` mapping
 */
export function parseWorkflow(path: string, source: string): Workflow {
  const doc = asRecord(parseYaml(source));
  if (!doc) throw new Error(`${path}: workflow is not a mapping`);
  const jobsNode = asRecord(doc['jobs'] ?? null);
  if (!jobsNode) throw new Error(`${path}: workflow has no jobs mapping`);

  const jobs: WorkflowJob[] = [];
  for (const [id, rawJob] of Object.entries(jobsNode)) {
    const job = asRecord(rawJob);
    if (!job) continue;
    const rawSteps = Array.isArray(job['steps']) ? job['steps'] : [];
    const steps: WorkflowStep[] = [];
    for (const rawStep of rawSteps) {
      const step = asRecord(rawStep);
      if (!step) continue;
      const uses = asString(step['uses']);
      const run = asString(step['run']);
      const name = asString(step['name']);
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(asRecord(step['env'] ?? null) ?? {})) {
        if (typeof value === 'string') env[key] = value;
      }
      steps.push({
        label: name ?? uses ?? (run === null ? '(unnamed step)' : firstLine(run)),
        uses,
        run,
        condition: asString(step['if']),
        continueOnError: step['continue-on-error'] === true,
        env,
        with: asRecord(step['with'] ?? null) ?? {},
      });
    }
    jobs.push({
      id,
      name: asString(job['name']),
      needs: asStringList(job['needs']),
      steps,
      continueOnError: job['continue-on-error'] === true,
      uses: asString(job['uses']),
    });
  }
  return { path, name: asString(doc['name']), advisory: hasAdvisoryWorkflowMarker(source), jobs };
}

/* -------------------------------------------------------------------------- */
/*  Rule engine                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Turbo task names whose execution constitutes a gating check.
 *
 * @remarks
 * `turbo run <task>` with any of these is treated as a check that the production
 * deploy must depend on. Extend this list when a new gating turbo task is
 * introduced; forgetting to is safe in one direction only (the job stops being
 * required), so the list is asserted against the real workflow by
 * `repo-tests/ci/ci-gate-policy.test.ts`.
 */
export const GATING_TURBO_TASKS: readonly string[] = [
  'test',
  'test:coverage',
  'lint',
  'typecheck',
  'build',
];

/**
 * Command fragments that identify a gating check outside of `turbo run`.
 *
 * @remarks
 * Matched as whole tokens against the step's `run` body, so `pnpm --filter
 * @docket/web test:e2e` and `pnpm format:check` are recognized while prose
 * mentioning the word "test" is not.
 */
export const GATING_COMMAND_TOKENS: readonly string[] = [
  'playwright',
  'test:e2e',
  'vitest',
  'format:check',
  // The repository-level suites under `repo-tests/`, which `turbo run test` cannot see because they
  // belong to no workspace package. This guard is one of them.
  'test:tooling',
  // The no-committed-credentials gate. It runs as a `run:` step rather than as gitleaks/gitleaks-action
  // (see the `secret-scan` job's comment in ci.yml), so the action pattern below would miss it.
  'secret-scan',
  // This checker itself. Today it runs inside `quality`, which is already a check job; listing
  // it means that if it is ever moved into a job of its own, that job is still required in
  // `deploy-production.needs` rather than becoming an unguarded guard.
  'ci:gate-policy',
];

/**
 * Action references that are themselves gating checks rather than shell commands.
 *
 * @remarks
 * A job whose only work is `uses: gitleaks/gitleaks-action` runs no `run` step,
 * so the shell heuristics would not see it. Listing such actions here keeps the
 * ungated-check-job guard honest for check jobs implemented purely as actions.
 */
export const GATING_ACTION_PATTERNS: readonly RegExp[] = [/^gitleaks\/gitleaks-action(@|$)/i];

/**
 * Action references whose failure reports a result but does not gate the build.
 *
 * @remarks
 * This is the deliberate soft-failed-gate carve-out. Coverage uploads and artifact uploads
 * legitimately carry `if: always()` — they exist precisely to run after a failed
 * check so the failure is diagnosable. Banning `if: always()` outright would push
 * teams to delete the diagnostics instead of the soft-fail, which is strictly
 * worse. The rule therefore only fires when the step's own `run` body executes a
 * gating command.
 */
export const REPORTING_ACTION_PATTERNS: readonly RegExp[] = [
  /^codecov\/codecov-action(@|$)/i,
  /^actions\/upload-artifact(@|$)/i,
  /^actions\/download-artifact(@|$)/i,
  /^dorny\/test-reporter(@|$)/i,
  /^mikepenz\/action-junit-report(@|$)/i,
];

/** Escapes a literal for embedding in a regular expression. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether a shell script body executes a gating check.
 *
 * @remarks
 * Two independent signals: an explicit `turbo run` invocation naming a task in
 * {@link GATING_TURBO_TASKS} (arguments are read up to the first shell operator so
 * `turbo run lint typecheck --cache-dir=.turbo` matches both tasks), or any token
 * from {@link GATING_COMMAND_TOKENS} appearing as a whole word.
 *
 * @param run - The step's `run` body
 * @returns `true` when the script runs a check whose failure must fail the build
 */
export function isGatingCommand(run: string): boolean {
  for (const match of run.matchAll(/\bturbo\s+run\s+([^\n|&;]*)/g)) {
    const args = (match[1] ?? '').split(/\s+/).filter(Boolean);
    for (const arg of args) {
      if (arg.startsWith('-')) break;
      if (GATING_TURBO_TASKS.includes(arg)) return true;
    }
  }
  return GATING_COMMAND_TOKENS.some((token) =>
    new RegExp(`(^|[\\s"'\`/])${escapeRegExp(token)}($|[\\s"'\`])`).test(run),
  );
}

/** Whether a step is a gating check (as opposed to setup, diagnostics, or reporting). */
export function isGatingStep(step: WorkflowStep): boolean {
  const uses = step.uses;
  if (uses !== null && GATING_ACTION_PATTERNS.some((pattern) => pattern.test(uses))) return true;
  return step.run !== null && isGatingCommand(step.run);
}

/** Whether a step exists to report or diagnose results rather than to gate them. */
export function isReportingStep(step: WorkflowStep): boolean {
  if (isGatingStep(step)) return false;
  if (step.uses) return true;
  return step.run === null || !isGatingCommand(step.run);
}

/** Whether a job executes at least one gating check. */
export function isCheckJob(job: WorkflowJob): boolean {
  return job.steps.some((step) => isGatingStep(step));
}

/** A single policy violation. */
export interface PolicyFinding {
  /** Which of the two rules this module enforces was broken. */
  readonly rule: 'ungated-check-job' | 'soft-failed-gate';
  /** Repository-relative workflow path. */
  readonly workflow: string;
  /** The offending job's identifier. */
  readonly job: string;
  /** The offending step's label, when the finding is step-scoped. */
  readonly step: string | null;
  /** Human-readable explanation, including the remedy. */
  readonly message: string;
}

/** Options for {@link checkGatePolicy}. */
export interface GatePolicyOptions {
  /**
   * Identifier of the job that performs the production deploy.
   *
   * @remarks
   * Check jobs in a workflow that owns this job must be listed in its `needs`.
   * A separate check-running workflow must instead identify itself as advisory;
   * otherwise `ungated-check-job` reports that it has no production-gating path.
   */
  readonly deployJobId?: string;
}

/** The job id that ships production, and the anchor for the ungated-check-job guard. */
export const DEFAULT_DEPLOY_JOB_ID = 'deploy-production';

/**
 * Determines whether a workflow visibly declares its checks advisory rather than deploy gates.
 *
 * @param workflow - Parsed workflow to classify
 * @returns `true` when its leading comment header contains the advisory directive
 */
export function isAdvisoryWorkflow(workflow: Workflow): boolean {
  return workflow.advisory;
}

/**
 * Evaluates every workflow against the two gate rules this module enforces.
 *
 * @remarks
 * `ungated-check-job`: within the workflow that declares the deploy job, every job that runs a
 * gating check must appear in that job's `needs`. A separate workflow that runs a
 * check must visibly call itself advisory, because GitHub Actions cannot make its
 * result a dependency of a deployment in another workflow. This makes both kinds
 * of signal explicit instead of reporting an advisory check as a deploy gate.
 *
 * `soft-failed-gate`: a gating step may not be soft-failed. Three distinct soft-fails are
 * detected — `continue-on-error: true` anywhere inside a check job (including at
 * job level, which is the most dangerous form because dependents still run), a
 * `|| true` / `|| exit 0` appended to a gating command, and `if: always()` on a
 * step that itself runs a gating command. Reporting steps are exempt from the
 * `if: always()` rule; see {@link REPORTING_ACTION_PATTERNS}.
 *
 * @param workflows - Parsed workflows to evaluate
 * @param options - Overrides for the deploy job identifier
 * @returns Every violation found, in workflow/job/step order. Empty means the gate holds.
 */
export function checkGatePolicy(
  workflows: readonly Workflow[],
  options: GatePolicyOptions = {},
): PolicyFinding[] {
  const deployJobId = options.deployJobId ?? DEFAULT_DEPLOY_JOB_ID;
  const findings: PolicyFinding[] = [];

  for (const workflow of workflows) {
    const deployJob = workflow.jobs.find((job) => job.id === deployJobId);
    const checkJobs = workflow.jobs.filter((job) => isCheckJob(job));
    if (deployJob) {
      const needs = new Set(deployJob.needs);
      for (const job of checkJobs) {
        if (job.id === deployJobId) continue;
        if (needs.has(job.id)) continue;
        findings.push({
          rule: 'ungated-check-job',
          workflow: workflow.path,
          job: job.id,
          step: null,
          message:
            `Job "${job.id}" runs gating checks but is not listed in ` +
            `${deployJobId}.needs — a failure there would not stop the production deploy. ` +
            `Add "${job.id}" to ${deployJobId}.needs.`,
        });
      }
    } else if (!isAdvisoryWorkflow(workflow)) {
      for (const job of checkJobs) {
        findings.push({
          rule: 'ungated-check-job',
          workflow: workflow.path,
          job: job.id,
          step: null,
          message:
            `Job "${job.id}" runs gating checks in a workflow with no ${deployJobId} job. ` +
            'Move it into the deploy workflow so it gates production, or add ' +
            `${ADVISORY_WORKFLOW_MARKER} to this workflow's comment header to mark the signal explicitly advisory.`,
        });
      }
    }

    for (const job of workflow.jobs) {
      if (!isCheckJob(job)) continue;
      if (job.continueOnError) {
        findings.push({
          rule: 'soft-failed-gate',
          workflow: workflow.path,
          job: job.id,
          step: null,
          message:
            `Job "${job.id}" runs gating checks with job-level continue-on-error: true — ` +
            'a failing check would still report success to dependent jobs. Remove it.',
        });
      }
      for (const step of job.steps) {
        if (step.continueOnError) {
          findings.push({
            rule: 'soft-failed-gate',
            workflow: workflow.path,
            job: job.id,
            step: step.label,
            message:
              `Step "${step.label}" in check job "${job.id}" sets continue-on-error: true — ` +
              'no step inside a gating job may swallow its own failure. Remove it.',
          });
        }
        if (
          step.run !== null &&
          isGatingCommand(step.run) &&
          /\|\|\s*(true|exit\s+0|:)\s*$/m.test(step.run)
        ) {
          findings.push({
            rule: 'soft-failed-gate',
            workflow: workflow.path,
            job: job.id,
            step: step.label,
            message:
              `Step "${step.label}" in job "${job.id}" appends "|| true" to a gating command — ` +
              'the check can never fail the build. Remove the fallback.',
          });
        }
        if (
          step.condition !== null &&
          /\balways\s*\(\s*\)/.test(step.condition) &&
          isGatingStep(step) &&
          !isReportingStep(step)
        ) {
          findings.push({
            rule: 'soft-failed-gate',
            workflow: workflow.path,
            job: job.id,
            step: step.label,
            message:
              `Step "${step.label}" in job "${job.id}" runs a gating command under if: always() — ` +
              'a gating check must not be forced to run (and report) after an earlier failure. ' +
              'if: always() is reserved for reporting steps (coverage/artifact upload).',
          });
        }
      }
    }
  }

  return findings;
}

/* -------------------------------------------------------------------------- */
/*  Loading + CLI                                                             */
/* -------------------------------------------------------------------------- */

/** Absolute path of the repository root, derived from this file's location. */
export const REPO_ROOT: string = fileURLToPath(new URL('..', import.meta.url));

/**
 * Loads and parses every workflow file under `.github/workflows`.
 *
 * @param root - Repository root to read from. Defaults to {@link REPO_ROOT}.
 * @returns Parsed workflows, sorted by path for deterministic output
 */
export function loadWorkflows(root: string = REPO_ROOT): Workflow[] {
  const dir = join(root, '.github', 'workflows');
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'))
    .sort()
    .map((entry) => {
      const absolute = join(dir, entry);
      return parseWorkflow(relative(root, absolute), readFileSync(absolute, 'utf8'));
    });
}

/**
 * Renders findings as a report suitable for a CI log.
 *
 * @param workflows - The workflows that were evaluated
 * @param findings - The violations found
 * @returns The report text (no trailing newline)
 */
export function formatReport(
  workflows: readonly Workflow[],
  findings: readonly PolicyFinding[],
): string {
  const lines: string[] = [
    'CI gate policy (ungated-check-job deploy gating, soft-failed-gate no soft-failed checks)',
    '',
  ];
  for (const workflow of workflows) {
    const checkJobs = workflow.jobs.filter((job) => isCheckJob(job)).map((job) => job.id);
    lines.push(
      `  ${workflow.path}: ${workflow.jobs.length} job(s), check job(s): ${
        checkJobs.length > 0 ? checkJobs.join(', ') : '(none)'
      }`,
    );
    const deployJob = workflow.jobs.find((job) => job.id === DEFAULT_DEPLOY_JOB_ID);
    if (deployJob)
      lines.push(`    ${DEFAULT_DEPLOY_JOB_ID}.needs = [${deployJob.needs.join(', ')}]`);
  }
  const advisoryWorkflows = workflows
    .filter(
      (workflow) => isAdvisoryWorkflow(workflow) && workflow.jobs.some((job) => isCheckJob(job)),
    )
    .map((workflow) => workflow.path);
  if (advisoryWorkflows.length > 0)
    lines.push(`  advisory check workflow(s): ${advisoryWorkflows.join(', ')}`);
  lines.push('');
  if (findings.length === 0) {
    lines.push(
      'PASS — every check in a deploy workflow gates production; advisory checks are explicitly ' +
        'identified; and no gating step is soft-failed.',
    );
    return lines.join('\n');
  }
  lines.push(`FAIL — ${findings.length} violation(s):`);
  for (const finding of findings) {
    const where = finding.step ? `${finding.job} › ${finding.step}` : finding.job;
    lines.push(`  [${finding.rule}] ${finding.workflow} :: ${where}`);
    lines.push(`      ${finding.message}`);
  }
  return lines.join('\n');
}

/**
 * CLI entry point: evaluates the repository's workflows and reports the result.
 *
 * @param root - Repository root to evaluate. Defaults to {@link REPO_ROOT}.
 * @returns The process exit code — `0` when the gate holds, `1` otherwise
 */
export function runCli(root: string = REPO_ROOT): number {
  const workflows = loadWorkflows(root);
  const findings = checkGatePolicy(workflows);
  process.stdout.write(`${formatReport(workflows, findings)}\n`);
  return findings.length === 0 ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  process.exitCode = runCli();
}
