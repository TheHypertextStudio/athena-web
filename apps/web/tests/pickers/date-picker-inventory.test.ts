import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The gate behind the date-picker audit.
 *
 * @remarks
 * A written inventory rots the moment someone adds a picker without updating it, so the
 * inventory is not merely a document — it is data this test enforces:
 *
 * - **No surface may hand-roll a calendar-day control.** A bare `<input type="date">` cannot
 *   express the interaction contract (there is no highlighted day for Enter to commit, no grid
 *   for the arrows to move through) and behaves differently in every browser. Five of them
 *   existed; the allowlist below is empty and must stay that way.
 * - **Every date-picker call site is listed in the audit.** The test derives the call sites from
 *   source and compares them against `docs/design/audits/date-pickers.md`, so a new picker with
 *   no audit row fails the build.
 * - **No surface may concatenate a time onto a stored date before parsing it.** That expression
 *   is what put the literal string `"Invalid Date"` on the global task list.
 *
 * Instant fields (`datetime-local`) are a *different* control — they name a moment in a named
 * zone and carry DST-fold disambiguation — so they are inventoried separately and are not held
 * to the calendar-day contract. They are listed in the audit with that reasoning.
 */

/** Repository root, derived from this file's location rather than the process CWD. */
const REPO_ROOT = resolve(import.meta.dirname, '../../../..');

/** Source roots scanned for date surfaces. */
const SOURCE_ROOTS = ['apps/web/src', 'apps/admin/src'] as const;

/** The committed inventory this test holds the source to. */
const AUDIT_PATH = 'docs/design/audits/inventories/date-pickers.md';

/** The one module a calendar-day picker may come from, as written at a call site. */
const SANCTIONED_SPECIFIERS = ['@/components/date-picker', '@docket/ui/components'] as const;

/**
 * Files permitted to render a raw `<input type="date">`.
 *
 * @remarks
 * Deliberately empty. It exists so that adding an entry is a visible, reviewable act with a
 * written reason rather than a silent regression.
 */
const RAW_DATE_INPUT_ALLOWLIST: readonly string[] = [];

/** Every `.ts`/`.tsx` file under a root, repo-relative and POSIX-separated. */
function sourceFiles(root: string): readonly string[] {
  const absolute = join(REPO_ROOT, root);
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.tsx?$/.test(entry)) out.push(relative(REPO_ROOT, full).split(/[\\/]/).join('/'));
    }
  };
  walk(absolute);
  return out;
}

/** All scanned files paired with their contents. */
const FILES: readonly { readonly path: string; readonly text: string }[] = SOURCE_ROOTS.flatMap(
  (root) =>
    sourceFiles(root).map((path) => ({ path, text: readFileSync(join(REPO_ROOT, path), 'utf8') })),
);

/** Lines that are only prose (a doc comment or a `//` note), which never render anything. */
function isComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*');
}

describe('date picker inventory', () => {
  it('finds the source roots it claims to scan', () => {
    expect(FILES.length).toBeGreaterThan(300);
  });

  it('has no hand-rolled calendar-day input anywhere in web or admin', () => {
    const offenders = FILES.flatMap(({ path, text }) =>
      text
        .split('\n')
        .map((line, index) => ({ line, index }))
        .filter(
          ({ line }) => !isComment(line) && /type=(["'])date\1|type=\{['"]date['"]\}/.test(line),
        )
        .map(({ index }) => `${path}:${index + 1}`),
    ).filter((location) => !RAW_DATE_INPUT_ALLOWLIST.includes(location.split(':')[0] ?? ''));
    expect(offenders).toEqual([]);
  });

  it('imports the pickers from one module family only', () => {
    const imports = FILES.flatMap(({ path, text }) => {
      const matches = [...text.matchAll(/import\s+\{([^}]*)\}\s+from\s+'([^']+)'/g)];
      return matches
        .filter(([, names]) =>
          /\bDatePicker\b|\bDateRangePicker\b|\bTimeframePicker\b|\bTimeframeRangePicker\b/.test(
            names ?? '',
          ),
        )
        .map(([, , specifier]) => ({ path, specifier: specifier ?? '' }));
    });
    expect(imports.length).toBeGreaterThan(0);
    const strays = imports.filter(
      (entry) =>
        !SANCTIONED_SPECIFIERS.includes(entry.specifier as (typeof SANCTIONED_SPECIFIERS)[number]),
    );
    expect(strays).toEqual([]);
  });

  it('never formats a date by concatenating a time onto it first', () => {
    // The exact shape that shipped broken: a template literal that appends a clock time to a
    // stored value, parsed and formatted in one expression. When the stored value is already a
    // full ISO instant the concatenation yields nonsense, `Date` returns an invalid instant, and
    // `toLocaleDateString` renders the literal string `Invalid Date`. Day *arithmetic* on a
    // value known to be bare is not this defect and is not banned here.
    const offenders = FILES.flatMap(({ path, text }) =>
      // Match across lines: Prettier splits the option object onto its own lines.
      [...text.matchAll(/new Date\(`\$\{[^`]*\}T[^`]*`\)\s*\.toLocale/g)].map((match) => {
        const line = text.slice(0, match.index).split('\n').length;
        return `${path}:${line}`;
      }),
    );
    expect(offenders).toEqual([]);
  });

  it('lists every date-picker call site in the committed audit', () => {
    const audit = readFileSync(join(REPO_ROOT, AUDIT_PATH), 'utf8');
    const callSites = FILES.filter(({ text }) =>
      /<DatePicker\b|<DateRangePicker\b|<TimeframePicker\b|<TimeframeRangePicker\b/.test(text),
    ).map(({ path }) => path);
    expect(callSites.length).toBeGreaterThan(0);
    const missing = callSites.filter((path) => !audit.includes(path));
    expect(missing).toEqual([]);
  });

  it('lists every instant/time field in the committed audit too', () => {
    const audit = readFileSync(join(REPO_ROOT, AUDIT_PATH), 'utf8');
    const instantSurfaces = FILES.filter(({ text }) =>
      text
        .split('\n')
        .some(
          (line) =>
            !isComment(line) &&
            /type=(["'])(datetime-local|time|month|week)\1|type=\{inputType\}/.test(line),
        ),
    ).map(({ path }) => path);
    const missing = instantSurfaces.filter((path) => !audit.includes(path));
    expect(missing).toEqual([]);
  });
});
