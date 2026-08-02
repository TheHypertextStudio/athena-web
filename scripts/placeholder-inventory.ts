/**
 * `pnpm exec tsx scripts/placeholder-inventory.ts` — the standing inventory of every loading
 * placeholder in the product UI, and the gate that keeps it honest.
 *
 * @remarks
 * Docket's rule is that **a placeholder is legitimate only where the content genuinely cannot be
 * known before a fetch resolves.** Statically-known labels, headings, toolbars, column headers and
 * empty-state copy render immediately; a grey bar in place of the word "Projects" is strictly less
 * information than the word "Projects", and it costs the reader the ~400ms the fetch takes.
 *
 * That rule cannot be enforced by a one-time hand-written list, because such a list rots the moment
 * someone adds a component. So the convention is mechanical instead: any component that renders a
 * placeholder must carry a one-line
 *
 * ```ts
 * // placeholder: <the unknown-until-fetch data this stands in for>
 * ```
 *
 * comment somewhere inside it. One annotation covers every placeholder element in that component —
 * a five-bar card skeleton stands for one unknown thing, not five. This script finds every
 * placeholder, attributes it to its enclosing component, reads the annotation, and writes the
 * inventory to `docs/engineering/placeholder-inventory.md`.
 *
 * `--check` is the CI-shaped mode. It fails when a component **inside the enforced scope** renders
 * a placeholder without an annotation, and when the repo-wide unannotated count rises above
 * {@link UNANNOTATED_BUDGET}. Both are now tight: {@link ENFORCED_SCOPE} covers the whole product
 * UI, and the budget is down to the handful of placeholders in {@link EXEMPT_SCOPE}. The gate
 * shipped narrow — shell chrome and navigation only, with a 141-element tail — because the app had
 * 149 unexplained placeholders across 51 files at the time and a gate demanding all of them at once
 * would have been switched off within a week. The tail has since been worked to zero outside the
 * named exemption, so the scope was widened to match. Neither may be relaxed.
 *
 * Usage (from the repo root):
 *   tsx scripts/placeholder-inventory.ts            # rewrite the inventory document
 *   tsx scripts/placeholder-inventory.ts --check    # fail on a missing annotation or a risen tail
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root, resolved from this file's own location so the script is runnable from anywhere. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The source trees that render product UI. */
const SOURCE_ROOTS = ['apps/web/src', 'packages/ui/src'] as const;

/** Where the generated inventory lives. */
const OUTPUT_PATH = 'docs/engineering/placeholder-inventory.md';

/**
 * Path prefixes where a missing annotation is a hard failure.
 *
 * @remarks
 * Now the whole product UI. This list started as just the shell chrome and the navigation, because
 * the app had 149 placeholder elements across 51 files when the gate landed and demanding all of
 * them at once would have got the gate switched off within a week. That tail has since been worked
 * down to zero outside {@link EXEMPT_SCOPE}, so the narrow scope has done its job and the broad one
 * is what actually holds the requirement: *every* surviving placeholder names the unknown-until-
 * fetch data it stands in for.
 *
 * Only ever widen this list.
 */
const ENFORCED_SCOPE = ['apps/web/src', 'packages/ui/src'] as const;

/**
 * Paths inside {@link ENFORCED_SCOPE} that are measured but not yet gated.
 *
 * @remarks
 * The calendar surfaces, whose placeholders are being reworked alongside the scheduling canvas.
 * Listing them explicitly — rather than leaving {@link ENFORCED_SCOPE} narrow — means the gate
 * fails the moment a *new* file starts owing an explanation, and the exemption is a visible,
 * shrinking list rather than an invisible silence. Only ever remove entries from it.
 */
const EXEMPT_SCOPE = [
  'apps/web/src/app/(app)/calendar/',
  'apps/web/src/components/calendar/',
] as const;

/**
 * The number of placeholder elements allowed to remain unannotated outside the enforced scope.
 *
 * @remarks
 * A ratchet, not a target. It may only ever be lowered: annotate or delete placeholders, re-run the
 * script, and set this to the new total. Raising it means someone added an unexplained placeholder,
 * which is exactly the thing this file exists to stop. What remains is entirely
 * {@link EXEMPT_SCOPE}; the number reaches zero when those files are annotated and their exemption
 * is deleted.
 */
const UNANNOTATED_BUDGET = 6;

/** How a placeholder announces itself in source. */
type PlaceholderKind = 'skeleton' | 'animate-pulse' | 'status-loader';

/** One placeholder element found in the source tree. */
interface PlaceholderSite {
  /** Repo-relative path. */
  readonly file: string;
  /** 1-indexed line the placeholder is rendered on. */
  readonly line: number;
  /** The enclosing function/component name, or `<module>` when found at module scope. */
  readonly component: string;
  /** What matched. */
  readonly kind: PlaceholderKind;
  /** The `// placeholder:` annotation for the enclosing component, or `null` when absent. */
  readonly annotation: string | null;
  /** Whether a missing annotation here is a hard failure. */
  readonly enforced: boolean;
}

/** A function/component declaration and the line it starts on. */
interface ComponentSpan {
  readonly name: string;
  readonly startLine: number;
}

/** Directory names never worth walking. */
const SKIP_DIRECTORIES = new Set(['node_modules', '.next', 'dist', 'build', '.turbo']);

/**
 * Every `.ts`/`.tsx` file beneath `root`, depth-first and deterministically ordered.
 *
 * @param root - Absolute directory to walk.
 * @returns Absolute file paths.
 */
function sourceFiles(root: string): readonly string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory).sort()) {
      if (SKIP_DIRECTORIES.has(entry)) continue;
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry)) {
        found.push(full);
      }
    }
  };
  walk(root);
  return found;
}

/**
 * The function/component declarations in a file, in source order.
 *
 * @remarks
 * Deliberately regex-driven rather than AST-driven. The only question asked of the source is "which
 * declaration is this line inside", which the leading `function` / `const … =>` forms answer
 * unambiguously in this codebase's style, and a full parser would make the gate heavier than the
 * rule it enforces.
 *
 * Top-level `const` declarations only open a span when their name is capitalized — the React
 * component convention. Without that, a local like `const triggerLabel = loading ? …` would steal
 * attribution from the component that actually renders the placeholder, and the annotation would
 * have to be repeated beside every local instead of once per component.
 *
 * @param lines - The file's lines.
 * @returns Declarations with their 1-indexed start lines.
 */
function componentSpans(lines: readonly string[]): readonly ComponentSpan[] {
  const spans: ComponentSpan[] = [];
  const declaration = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/;
  const arrow = /^\s*(?:export\s+)?(?:const|let)\s+([A-Z][\w$]*)\s*[:=]/;
  lines.forEach((text, index) => {
    const match = declaration.exec(text) ?? arrow.exec(text);
    const name = match?.[1];
    if (name !== undefined) spans.push({ name, startLine: index + 1 });
  });
  return spans;
}

/**
 * The declaration a 1-indexed line belongs to.
 *
 * @param spans - Declarations in source order.
 * @param line - The 1-indexed line to attribute.
 * @returns The enclosing declaration name, or `<module>` at module scope.
 */
function enclosingComponent(spans: readonly ComponentSpan[], line: number): string {
  let name = '<module>';
  for (const span of spans) {
    if (span.startLine > line) break;
    name = span.name;
  }
  return name;
}

/**
 * Matches the annotation convention in `//`, `/* … *\/` and JSX `{/* … *\/}` comment forms.
 *
 * @remarks
 * The marker must be the **first** thing in the comment body. Two things depend on that strictness.
 * Tailwind ships a `placeholder:` variant, so `className="placeholder:text-on-surface-variant"`
 * would otherwise register as an annotation on every styled `<textarea>` in the app. And prose that
 * merely mentions the word — `/** Loading placeholder: row-height blocks *\/` — describes what the
 * placeholder *looks like*, which is not the question; the annotation must name the unknown data.
 */
const ANNOTATION = /(?:\/\/|\/\*\*?|\{\/\*|^\s*\*)\s*placeholder:\s*(.+?)\s*(?:\*+\/\}?)?\s*$/;

/** True for a line that is only a comment, so a mention of a placeholder in prose is not a usage. */
function isCommentLine(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('{/*');
}

/**
 * Classify a line as a placeholder render site, or `null` when it is not one.
 *
 * @remarks
 * `role="status"` only counts when the surrounding element is announcing a *load*: the role is also
 * the correct one for a settled live region (a save confirmation, a result count), and flagging
 * those would train readers to ignore the report.
 *
 * @param lines - The file's lines.
 * @param index - 0-indexed line to classify.
 * @returns The kind matched, or `null`.
 */
function classify(lines: readonly string[], index: number): PlaceholderKind | null {
  const text = lines[index] ?? '';
  if (isCommentLine(text)) return null;
  if (/<Skeleton[\s/>]/.test(text)) return 'skeleton';
  if (text.includes('animate-pulse')) return 'animate-pulse';
  if (/role=["']status["']/.test(text)) {
    const window = lines.slice(Math.max(0, index - 2), index + 4).join('\n');
    if (/aria-busy|[Ll]oading/.test(window)) return 'status-loader';
  }
  return null;
}

/**
 * Read the annotation for a declaration, searching from its start to the next declaration.
 *
 * @remarks
 * A `//` annotation that wraps onto following `//` lines is joined back into one sentence, so the
 * convention does not force an explanation to fit the line-length limit at the cost of saying less.
 *
 * @param lines - The file's lines.
 * @param spans - Declarations in source order.
 * @param component - The declaration to read.
 * @returns The annotation text, or `null` when the component carries none.
 */
function annotationFor(
  lines: readonly string[],
  spans: readonly ComponentSpan[],
  component: string,
): string | null {
  const index = spans.findIndex((span) => span.name === component);
  // A module-scope hit (or an unrecognized declaration) still gets an annotation if the file
  // carries one anywhere, since there is no narrower scope to attribute it to. The `- 2` lets the
  // annotation sit on the line immediately above the declaration as well as inside it.
  const from = index === -1 ? 0 : Math.max(0, (spans[index]?.startLine ?? 1) - 2);
  const next = index === -1 ? undefined : spans[index + 1];
  const to = next ? next.startLine - 1 : lines.length;
  for (let cursor = from; cursor < to; cursor += 1) {
    const match = ANNOTATION.exec(lines[cursor] ?? '');
    const head = match?.[1];
    if (head === undefined || head.length === 0) continue;
    const parts = [head];
    for (let follow = cursor + 1; follow < to; follow += 1) {
      const text = (lines[follow] ?? '').trimStart();
      if (!text.startsWith('//')) break;
      parts.push(text.slice(2).trim());
    }
    return parts.join(' ').trim();
  }
  return null;
}

/** Whether a repo-relative path matches any of `prefixes`. */
function hasPrefix(file: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => file === prefix || file.startsWith(prefix));
}

/** Whether a repo-relative path sits in the hard-failure scope. */
function isEnforced(file: string): boolean {
  return hasPrefix(file, ENFORCED_SCOPE) && !hasPrefix(file, EXEMPT_SCOPE);
}

/**
 * Scan the product source trees for every placeholder render site.
 *
 * @returns Every site found, ordered by file then line.
 */
export function collectPlaceholders(): readonly PlaceholderSite[] {
  const sites: PlaceholderSite[] = [];
  for (const root of SOURCE_ROOTS) {
    for (const absolute of sourceFiles(resolve(REPO_ROOT, root))) {
      const file = relative(REPO_ROOT, absolute);
      const lines = readFileSync(absolute, 'utf8').split('\n');
      const spans = componentSpans(lines);
      const annotationCache = new Map<string, string | null>();
      lines.forEach((_text, index) => {
        const kind = classify(lines, index);
        if (kind === null) return;
        const component = enclosingComponent(spans, index + 1);
        if (!annotationCache.has(component)) {
          annotationCache.set(component, annotationFor(lines, spans, component));
        }
        sites.push({
          file,
          line: index + 1,
          component,
          kind,
          annotation: annotationCache.get(component) ?? null,
          enforced: isEnforced(file),
        });
      });
    }
  }
  return sites;
}

/** Escape the pipe characters that would otherwise break a Markdown table cell. */
function cell(value: string): string {
  return value.replaceAll('|', '\\|');
}

/**
 * Render the inventory document.
 *
 * @param sites - Every placeholder found.
 * @returns The complete Markdown document.
 */
function renderDocument(sites: readonly PlaceholderSite[]): string {
  const annotated = sites.filter((site) => site.annotation !== null);
  const unannotated = sites.filter((site) => site.annotation === null);
  const enforced = sites.filter((site) => site.enforced);
  const files = new Set(sites.map((site) => site.file));

  const rows = sites.map(
    (site) =>
      `| \`${site.file}:${String(site.line)}\` | \`${cell(site.component)}\` | ${site.kind} | ${
        site.annotation === null ? '**unannotated**' : cell(site.annotation)
      } |`,
  );

  const unannotatedByFile = new Map<string, number>();
  for (const site of unannotated) {
    unannotatedByFile.set(site.file, (unannotatedByFile.get(site.file) ?? 0) + 1);
  }
  const tail = [...unannotatedByFile.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([file, count]) => `| \`${file}\` | ${String(count)} |`);

  return `# Placeholder inventory

<!-- GENERATED FILE — do not edit by hand. Regenerate with:
     pnpm exec tsx scripts/placeholder-inventory.ts
     Everything below the preamble is produced from source. -->

## The rule

A placeholder is legitimate **only where the content genuinely cannot be known before a fetch
resolves.** Statically-known labels, headings, toolbars, column headers and empty-state copy render
immediately. A grey bar in place of the word "Projects" is strictly less information than the word
"Projects", and it costs the reader the time the fetch takes.

Two corollaries the app is held to:

- **Never gate a whole screen on a fetch.** Each surface paints its own heading and toolbar from
  static copy and confines any loading treatment to the data region it belongs to.
- **Never animate over data you already have.** A cached or hydrated read renders its content; a
  loader over it is a lie about what is known.

## The annotation convention

Any component that renders a placeholder carries a one-line comment naming what the placeholder
stands in for:

\`\`\`ts
// placeholder: the signed-in account's name, email and avatar — unknown until a session resolves
\`\`\`

One annotation covers every placeholder element in that component: a five-bar card skeleton stands
in for one unknown thing, not five. Both \`//\` and JSX \`{/* … */}\` comment forms are read.

## How this file is produced

\`\`\`bash
pnpm exec tsx scripts/placeholder-inventory.ts          # rewrite this document
pnpm exec tsx scripts/placeholder-inventory.ts --check  # fail on a missing annotation
\`\`\`

\`--check\` fails when a component inside the **enforced scope** renders a placeholder with no
annotation, and when the repo-wide unannotated count rises above the ratchet recorded in the script.
The enforced scope is the whole product UI:

${ENFORCED_SCOPE.map((prefix) => `- \`${prefix}\``).join('\n')}

with these paths measured but not yet gated, pending a rework of the calendar surfaces:

${EXEMPT_SCOPE.map((prefix) => `- \`${prefix}\``).join('\n')}

The exemption is written down rather than left as a narrow scope, so a *new* file that owes an
explanation fails the gate immediately and the list of what is outstanding can only shrink. The
tail below names exactly which files still owe one.

## Summary

| Metric | Count |
| --- | --- |
| Placeholder elements | ${String(sites.length)} |
| Files containing one | ${String(files.size)} |
| Annotated | ${String(annotated.length)} |
| Unannotated | ${String(unannotated.length)} |
| Inside the enforced scope | ${String(enforced.length)} |
| Unannotated inside the enforced scope | ${String(
    enforced.filter((site) => site.annotation === null).length,
  )} |

## Remaining unannotated, by file

| File | Unannotated placeholders |
| --- | --- |
${tail.join('\n')}

## Every placeholder

| Location | Component | Kind | Stands in for |
| --- | --- | --- | --- |
${rows.join('\n')}
`;
}

/**
 * Entry point: rewrite the inventory, or verify it in `--check` mode.
 *
 * @returns The process exit code — `0` when clean, `1` on a violation.
 */
export function main(): number {
  const check = process.argv.includes('--check');
  const sites = collectPlaceholders();
  const violations = sites.filter((site) => site.enforced && site.annotation === null);
  const unannotated = sites.filter((site) => site.annotation === null);

  if (!check) {
    writeFileSync(resolve(REPO_ROOT, OUTPUT_PATH), renderDocument(sites), 'utf8');
    process.stdout.write(
      `placeholder-inventory: ${String(sites.length)} placeholders, ${String(
        unannotated.length,
      )} unannotated → ${OUTPUT_PATH}\n`,
    );
    return 0;
  }

  for (const site of violations) {
    process.stderr.write(
      `${site.file}:${String(site.line)}: ${site.component} renders a placeholder with no ` +
        `"// placeholder: <what it stands in for>" annotation.\n`,
    );
  }
  if (unannotated.length > UNANNOTATED_BUDGET) {
    process.stderr.write(
      `placeholder-inventory: ${String(unannotated.length)} unannotated placeholders exceeds the ` +
        `ratchet of ${String(UNANNOTATED_BUDGET)}. Annotate or delete the new ones — the budget ` +
        `may only be lowered.\n`,
    );
  }
  if (violations.length > 0 || unannotated.length > UNANNOTATED_BUDGET) return 1;

  process.stdout.write(
    `placeholder-inventory: ${String(sites.length)} placeholders, ` +
      `${String(sites.length - unannotated.length)} annotated, ` +
      `${String(unannotated.length)}/${String(UNANNOTATED_BUDGET)} of the unannotated budget used.\n`,
  );
  return 0;
}

process.exitCode = main();
