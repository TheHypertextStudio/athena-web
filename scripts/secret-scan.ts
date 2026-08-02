/**
 * Secret scanner — proves no credential is committed to the tracked tree (GEN-06, clause 1).
 *
 * @remarks
 * The launch acceptance for GEN-06 names "a secret scan (gitleaks or trufflehog)". Neither
 * binary is installed here, and a security gate that has to download and execute a release
 * asset before it can run is a gate that fails open the day the asset moves, the vendor adds a
 * license check, or the runner has no egress. So the rules live in a real `.gitleaks.toml` —
 * consumable by the upstream binary for anyone who wants a second opinion or wants to scan git
 * *history* — and this module implements the scan itself in plain Node: no network, no
 * download, no dependency outside the standard library.
 *
 * That means shipping a small TOML reader ({@link parseToml}), for the same reason
 * `scripts/ci-gate-policy.ts` ships its own narrow YAML reader: the repo intentionally carries
 * no TOML parser in its dependency tree and a security gate must not be the thing that adds one.
 * It covers exactly the subset `.gitleaks.toml` uses — tables, arrays of tables, string arrays,
 * literal (`'''…'''`) and basic (`"…"`) strings, numbers and booleans.
 *
 * The file set is `git ls-files`, i.e. what is actually committed. Untracked build output and
 * `node_modules` are therefore out of scope by construction; the allowlist paths restate that
 * so the upstream binary (which walks the filesystem) behaves the same way.
 *
 * @example
 * ```bash
 * pnpm exec tsx scripts/secret-scan.ts   # exits 0 on a clean scan, 1 with a per-finding report
 * ```
 *
 * @see {@link scanFiles} for the rule engine (drive it with in-memory fixtures in tests)
 * @see {@link loadSecretScanConfig} for the `.gitleaks.toml` projection
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root — this file lives in `<root>/scripts`. */
export const REPO_ROOT: string = fileURLToPath(new URL('..', import.meta.url));

/**
 * Inline opt-out marker. A line carrying it is exempt from every rule.
 *
 * @remarks
 * gitleaks' own convention. Used by this scanner's test fixtures, which must contain
 * credential-shaped strings in order to prove the rules fire at all.
 */
export const ALLOW_MARKER = 'gitleaks:allow';

/** Files larger than this are skipped — no credential is megabytes long, and reading them is waste. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/* -------------------------------------------------------------------------- */
/* TOML (the subset `.gitleaks.toml` uses)                                     */
/* -------------------------------------------------------------------------- */

/** A value a {@link parseToml} document can hold. */
export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;

/** A TOML table (an object keyed by bare or quoted keys). */
export interface TomlTable {
  [key: string]: TomlValue | undefined;
}

/** Strip a `#` comment that is not inside a string literal. */
function stripComment(line: string): string {
  let inBasic = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i - 1] !== '\\') inBasic = !inBasic;
    if (ch === '#' && !inBasic) return line.slice(0, i);
  }
  return line;
}

/** Parse a single scalar/array TOML value from `raw` (already comment-stripped and trimmed). */
function parseScalar(raw: string): TomlValue {
  const text = raw.trim();
  if (text.startsWith("'''")) return text.slice(3, text.lastIndexOf("'''"));
  if (text.startsWith('"""')) return text.slice(3, text.lastIndexOf('"""'));
  if (text.startsWith("'")) return text.slice(1, text.lastIndexOf("'"));
  if (text.startsWith('"')) {
    return text
      .slice(1, text.lastIndexOf('"'))
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  const num = Number(text);
  if (text.length > 0 && Number.isFinite(num)) return num;
  return text;
}

/** Split an array body (`a, b, c` without the brackets) into element sources. */
function splitArrayElements(body: string): string[] {
  const elements: string[] = [];
  let current = '';
  let quote: "'''" | '"""' | "'" | '"' | null = null;
  for (let i = 0; i < body.length; i += 1) {
    if (quote === null) {
      if (body.startsWith("'''", i)) quote = "'''";
      else if (body.startsWith('"""', i)) quote = '"""';
      else if (body[i] === "'") quote = "'";
      else if (body[i] === '"') quote = '"';
      if (quote !== null && quote.length === 3) {
        current += quote;
        i += 2;
        continue;
      }
      if (body[i] === ',') {
        if (current.trim().length > 0) elements.push(current.trim());
        current = '';
        continue;
      }
    } else if (body.startsWith(quote, i)) {
      current += quote;
      i += quote.length - 1;
      quote = null;
      continue;
    }
    current += body[i] ?? '';
  }
  if (current.trim().length > 0) elements.push(current.trim());
  return elements;
}

/** Walk (creating as needed) the table at `path`, returning the container to assign into. */
function resolveTable(root: TomlTable, path: string[], asArrayElement: boolean): TomlTable {
  let node: TomlTable = root;
  for (let i = 0; i < path.length; i += 1) {
    const key = path[i] ?? '';
    const last = i === path.length - 1;
    const existing = node[key];
    if (last && asArrayElement) {
      const arr = Array.isArray(existing) ? (existing as TomlTable[]) : [];
      const created: TomlTable = {};
      arr.push(created);
      node[key] = arr;
      return created;
    }
    if (Array.isArray(existing)) {
      node = existing[existing.length - 1] as TomlTable;
      continue;
    }
    // `typeof null === 'object'`, and this walks freshly parsed TOML whose declared type cannot
    // promise the absence of null, so the guard is load-bearing at runtime even though the type
    // checker sees no overlap.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (typeof existing === 'object' && existing !== null) {
      node = existing;
      continue;
    }
    const created: TomlTable = {};
    node[key] = created;
    node = created;
  }
  return node;
}

/** Split a table header (`rules.allowlist`) into its key path, honoring quoted segments. */
function splitHeader(header: string): string[] {
  return header
    .split('.')
    .map((part) => part.trim().replace(/^["']|["']$/g, ''))
    .filter((part) => part.length > 0);
}

/**
 * Parse the TOML subset `.gitleaks.toml` is written in.
 *
 * @remarks
 * Supported: comments, `[table]` and `[[array-of-tables]]` headers (dotted), `key = value`
 * assignments, literal (`'…'`, `'''…'''`) and basic (`"…"`, `"""…"""`) strings, booleans,
 * numbers, and single- or multi-line arrays of any of those. Deliberately unsupported: inline
 * tables, dates, and multi-line basic-string escapes — none appear in this repo's config, and a
 * parser that silently guesses at constructs it does not implement is worse than one that does
 * not accept them.
 *
 * @param source - The TOML document text.
 * @returns The parsed document as a plain object tree.
 * @throws {Error} When a line is neither a header, an assignment, nor blank.
 */
export function parseToml(source: string): TomlTable {
  const root: TomlTable = {};
  let current: TomlTable = root;
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = stripComment(lines[i] ?? '').trim();
    if (line.length === 0) continue;

    if (line.startsWith('[[') && line.endsWith(']]')) {
      current = resolveTable(root, splitHeader(line.slice(2, -2)), true);
      continue;
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      current = resolveTable(root, splitHeader(line.slice(1, -1)), false);
      continue;
    }

    const eq = line.indexOf('=');
    if (eq < 0) throw new Error(`secret-scan: unparseable TOML at line ${i + 1}: ${line}`);
    const key = line
      .slice(0, eq)
      .trim()
      .replace(/^["']|["']$/g, '');
    let value = line.slice(eq + 1).trim();

    // Multi-line triple-quoted string: consume until the closing delimiter.
    for (const fence of ["'''", '"""'] as const) {
      if (value.startsWith(fence) && !value.slice(fence.length).includes(fence)) {
        const parts: string[] = [value.slice(fence.length)];
        while (i + 1 < lines.length) {
          i += 1;
          const next = lines[i] ?? '';
          const end = next.indexOf(fence);
          if (end >= 0) {
            parts.push(next.slice(0, end));
            break;
          }
          parts.push(next);
        }
        current[key] = parts.join('\n').replace(/^\n/, '');
        value = '';
        break;
      }
    }
    if (value.length === 0) continue;

    // Multi-line array: accumulate raw lines until the brackets balance.
    if (value.startsWith('[') && !value.endsWith(']')) {
      let depth = 0;
      let buffer = '';
      let done = false;
      let cursor = i;
      while (cursor < lines.length && !done) {
        const chunk = cursor === i ? value : stripComment(lines[cursor] ?? '');
        for (const ch of chunk) {
          if (ch === '[') depth += 1;
          if (ch === ']') depth -= 1;
          buffer += ch;
          if (depth === 0 && buffer.trim().endsWith(']')) done = true;
        }
        buffer += '\n';
        cursor += 1;
      }
      i = cursor - 1;
      value = buffer.trim();
    }

    if (value.startsWith('[') && value.endsWith(']')) {
      current[key] = splitArrayElements(value.slice(1, -1)).map(parseScalar);
      continue;
    }
    current[key] = parseScalar(value);
  }

  return root;
}

/* -------------------------------------------------------------------------- */
/* Config projection                                                           */
/* -------------------------------------------------------------------------- */

/** What an allowlist can exempt, at the global or per-rule level. */
export interface SecretScanAllowlist {
  /** Why these exemptions exist — surfaced in the report when a rule is fully allowlisted. */
  readonly description: string;
  /** File paths (repo-relative, POSIX separators) that are never scanned. */
  readonly paths: readonly RegExp[];
  /** Candidate values (or lines, per {@link regexTarget}) that are not findings. */
  readonly regexes: readonly RegExp[];
  /** Whether {@link regexes} test the matched candidate or its whole source line. */
  readonly regexTarget: 'match' | 'line';
  /** Case-insensitive substrings that mark a candidate as a deliberate placeholder. */
  readonly stopwords: readonly string[];
}

/** One detection rule, projected from a `[[rules]]` block. */
export interface SecretScanRule {
  /** Stable rule id, printed with every finding. */
  readonly id: string;
  /** Human-readable statement of what this rule detects. */
  readonly description: string;
  /** The compiled detection pattern. */
  readonly regex: RegExp;
  /** Capture group holding the secret; `0` means the whole match. */
  readonly secretGroup: number;
  /** Minimum Shannon entropy (bits/char) the secret must carry, or `null` for no floor. */
  readonly entropy: number | null;
  /** Rule-scoped exemptions, or `null` when the rule has none. */
  readonly allowlist: SecretScanAllowlist | null;
}

/** The whole scan configuration. */
export interface SecretScanConfig {
  /** The config's `title`, echoed in the report header. */
  readonly title: string;
  /** Every `[[rules]]` block, in file order. */
  readonly rules: readonly SecretScanRule[];
  /** The global `[allowlist]`, or `null` when absent. */
  readonly allowlist: SecretScanAllowlist | null;
}

/** One file to scan. */
export interface ScannedFile {
  /** Repo-relative POSIX path. */
  readonly path: string;
  /** UTF-8 contents. */
  readonly content: string;
}

/** One credential-shaped candidate that survived every allowlist. */
export interface SecretFinding {
  /** Repo-relative POSIX path of the file it was found in. */
  readonly path: string;
  /** 1-indexed line the match starts on. */
  readonly line: number;
  /** The {@link SecretScanRule.id} that matched. */
  readonly ruleId: string;
  /** The candidate, truncated to its first four characters. Never the full value. */
  readonly redacted: string;
}

/**
 * Compile a `.gitleaks.toml` regex string for JavaScript's engine.
 *
 * @remarks
 * gitleaks patterns are RE2, whose only construct JavaScript lacks a spelling for is the leading
 * `(?i)` inline flag. That is translated to the `i` flag; anything else is passed through
 * unchanged so a pattern cannot mean one thing to this scanner and another to the binary.
 *
 * @param pattern - The raw regex source from the config.
 * @returns A global-flagged {@link RegExp}.
 */
export function compileRuleRegex(pattern: string): RegExp {
  const caseInsensitive = pattern.startsWith('(?i)');
  const body = caseInsensitive ? pattern.slice(4) : pattern;
  return new RegExp(body, caseInsensitive ? 'gi' : 'g');
}

/** Read a `string[]` field, tolerating absence and single-string shorthand. */
function stringArray(value: TomlValue | undefined): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/** Project an `[allowlist]` table, or `null` when it carries no exemptions at all. */
function toAllowlist(table: TomlValue | undefined): SecretScanAllowlist | null {
  // See `resolveTable`: `typeof null === 'object'`, so this rejects a null the declared type does
  // not admit but parsed TOML can still produce.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof table !== 'object' || table === null || Array.isArray(table)) return null;
  const raw = table;
  const paths = stringArray(raw['paths']).map((p) => new RegExp(p));
  const regexes = stringArray(raw['regexes']).map((r) => compileRuleRegex(r));
  const stopwords = stringArray(raw['stopwords']).map((s) => s.toLowerCase());
  if (paths.length === 0 && regexes.length === 0 && stopwords.length === 0) return null;
  return {
    description: typeof raw['description'] === 'string' ? raw['description'] : '',
    paths,
    regexes,
    regexTarget: raw['regexTarget'] === 'line' ? 'line' : 'match',
    stopwords,
  };
}

/**
 * Read and project `.gitleaks.toml` into the shape {@link scanFiles} consumes.
 *
 * @remarks
 * `[extend]` is deliberately ignored: this scanner ships no bundled ruleset, and silently
 * behaving as though it had inherited one would make the gate weaker than it reads. The config
 * documents that split for the reader.
 *
 * @param configPath - Absolute path to the gitleaks config.
 * @returns The projected configuration.
 * @throws {Error} When the config declares no rules — a scanner with no rules passes vacuously.
 */
export function loadSecretScanConfig(configPath: string): SecretScanConfig {
  const doc = parseToml(readFileSync(configPath, 'utf8'));
  const rawRules = Array.isArray(doc['rules']) ? (doc['rules'] as TomlTable[]) : [];
  const rules: SecretScanRule[] = rawRules.map((raw) => {
    const id = typeof raw['id'] === 'string' ? raw['id'] : '';
    const pattern = typeof raw['regex'] === 'string' ? raw['regex'] : '';
    if (id.length === 0 || pattern.length === 0) {
      throw new Error(
        `secret-scan: every [[rules]] block needs an id and a regex (got id="${id}")`,
      );
    }
    return {
      id,
      description: typeof raw['description'] === 'string' ? raw['description'] : '',
      regex: compileRuleRegex(pattern),
      secretGroup: typeof raw['secretGroup'] === 'number' ? raw['secretGroup'] : 0,
      entropy: typeof raw['entropy'] === 'number' ? raw['entropy'] : null,
      allowlist: toAllowlist(raw['allowlist']),
    };
  });
  if (rules.length === 0) {
    throw new Error(
      `secret-scan: ${configPath} declares no [[rules]] — the scan would pass vacuously`,
    );
  }
  return {
    title: typeof doc['title'] === 'string' ? doc['title'] : 'secret scan',
    rules,
    allowlist: toAllowlist(doc['allowlist']),
  };
}

/* -------------------------------------------------------------------------- */
/* Scanning                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Shannon entropy of a string, in bits per character.
 *
 * @remarks
 * The discriminator between `test-secret-at-least-32-characters-long` (English, ~4.0) and a
 * base64-encoded 32-byte key (~5.5+). Used only by rules that declare an `entropy` floor.
 *
 * @param value - The candidate secret.
 * @returns Bits of entropy per character; `0` for the empty string.
 */
export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/**
 * Reduce a candidate to a form safe to print in a CI log.
 *
 * @remarks
 * A scanner that echoes what it found copies the credential into the build log, where it lives
 * as long as the run does. Four characters is enough to locate the value in the file and not
 * enough to use.
 *
 * @param value - The candidate secret.
 * @returns The first four characters, an ellipsis, and the candidate's length.
 */
export function redactSecret(value: string): string {
  return `${value.slice(0, 4)}…(${value.length} chars)`;
}

/** Whether `path` is exempted by an allowlist's `paths`. */
function pathAllowed(allowlist: SecretScanAllowlist | null, path: string): boolean {
  return allowlist?.paths.some((re) => re.test(path)) ?? false;
}

/** Whether a candidate is exempted by an allowlist's `regexes`/`stopwords`. */
function valueAllowed(
  allowlist: SecretScanAllowlist | null,
  candidate: string,
  line: string,
): boolean {
  if (allowlist === null) return false;
  const lowered = candidate.toLowerCase();
  if (allowlist.stopwords.some((word) => lowered.includes(word))) return true;
  const target = allowlist.regexTarget === 'line' ? line : candidate;
  return allowlist.regexes.some((re) => {
    re.lastIndex = 0;
    return re.test(target);
  });
}

/** Offsets at which each line of `content` starts, for O(log n) index→line lookup. */
function lineStarts(content: string): number[] {
  const starts = [0];
  for (let i = content.indexOf('\n'); i >= 0; i = content.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

/** 1-indexed line number containing byte offset `index`. */
function lineAt(starts: readonly number[], index: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if ((starts[mid] ?? 0) <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * Apply every rule to every file and return the surviving findings.
 *
 * @remarks
 * Exported so tests can drive the exact production rule set over synthetic in-memory fixtures.
 * That matters more than it sounds: a scan of a clean repository passes whether the rules work
 * or not, so the only way to know this gate is real is to feed it credentials it must catch.
 *
 * @param files - The files to scan.
 * @param config - The projected configuration.
 * @returns Findings sorted by path, then line, then rule id.
 */
export function scanFiles(files: Iterable<ScannedFile>, config: SecretScanConfig): SecretFinding[] {
  const findings: SecretFinding[] = [];

  for (const file of files) {
    if (pathAllowed(config.allowlist, file.path)) continue;
    const starts = lineStarts(file.content);
    const lines = file.content.split('\n');

    for (const rule of config.rules) {
      if (pathAllowed(rule.allowlist, file.path)) continue;
      rule.regex.lastIndex = 0;
      for (const match of file.content.matchAll(rule.regex)) {
        const candidate = rule.secretGroup > 0 ? (match[rule.secretGroup] ?? '') : match[0];
        if (candidate.length === 0) continue;
        const lineNumber = lineAt(starts, match.index);
        const lineText = lines[lineNumber - 1] ?? '';
        if (lineText.includes(ALLOW_MARKER)) continue;
        if (rule.entropy !== null && shannonEntropy(candidate) < rule.entropy) continue;
        if (valueAllowed(config.allowlist, candidate, lineText)) continue;
        if (valueAllowed(rule.allowlist, candidate, lineText)) continue;
        findings.push({
          path: file.path,
          line: lineNumber,
          ruleId: rule.id,
          redacted: redactSecret(candidate),
        });
      }
    }
  }

  return findings.sort(
    (a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.ruleId.localeCompare(b.ruleId),
  );
}

/**
 * Read every git-tracked, text, reasonably-sized file under `root`.
 *
 * @remarks
 * `git ls-files` rather than a filesystem walk: what is committed is exactly what can leak, and
 * it costs nothing to be right about ignored directories. Binary files are detected by a NUL
 * byte in the first 8 KiB and skipped — a credential is text.
 *
 * @param root - Repository root.
 * @returns Every scannable tracked file, with contents.
 */
export function collectTrackedFiles(root: string = REPO_ROOT): ScannedFile[] {
  const listing = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const files: ScannedFile[] = [];
  for (const relative of listing.split('\0')) {
    if (relative.length === 0) continue;
    let buffer: Buffer;
    try {
      buffer = readFileSync(join(root, relative));
    } catch {
      // Tracked but absent from the worktree (a deletion staged elsewhere in a shared tree).
      continue;
    }
    if (buffer.byteLength > MAX_FILE_BYTES) continue;
    if (buffer.subarray(0, 8192).includes(0)) continue;
    files.push({ path: relative, content: buffer.toString('utf8') });
  }
  return files;
}

/**
 * Render the scan result as the text the CLI prints.
 *
 * @param config - The configuration that produced the findings.
 * @param fileCount - How many files were scanned.
 * @param findings - The findings, as returned by {@link scanFiles}.
 * @returns The full report, without a trailing newline.
 */
export function formatReport(
  config: SecretScanConfig,
  fileCount: number,
  findings: readonly SecretFinding[],
): string {
  const header = `${config.title}: ${fileCount} tracked file(s), ${config.rules.length} rule(s)`;
  if (findings.length === 0) {
    return `${header}\nPASS — 0 findings.`;
  }
  const lines = [header, `FAIL — ${findings.length} finding(s):`, ''];
  for (const finding of findings) {
    lines.push(`  ${finding.path}:${finding.line}  ${finding.ruleId}  ${finding.redacted}`);
  }
  lines.push(
    '',
    `Rotate anything real, remove it from the tree, and re-run. If a match is a deliberate`,
    `fixture, append a \`${ALLOW_MARKER}\` comment to that line rather than widening a rule.`,
  );
  return lines.join('\n');
}

/**
 * CLI entry point: scans the tracked tree and reports the result.
 *
 * @param root - Repository root to scan. Defaults to {@link REPO_ROOT}.
 * @returns The process exit code — `0` on a clean scan, `1` when anything was found.
 */
export function runCli(root: string = REPO_ROOT): number {
  const config = loadSecretScanConfig(join(root, '.gitleaks.toml'));
  const files = collectTrackedFiles(root);
  const findings = scanFiles(files, config);
  process.stdout.write(`${formatReport(config, files.length, findings)}\n`);
  return findings.length === 0 ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  process.exitCode = runCli();
}
