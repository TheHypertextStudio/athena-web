import { CopySourceIdentity, copyIdentityKey } from '@docket/work/template-copy';
import { z } from 'zod';
import { ValidationError } from '../../error';
const fingerprint = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const entryKey = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const acceptance = z
  .object({
    requestId: z.string().min(1).max(128),
    reviewFingerprint: fingerprint,
    choicesFingerprint: fingerprint.optional(),
    mode: z.enum(['private_drafts', 'published']),
    roots: z.array(entryKey).min(1).max(100),
    entries: z
      .array(
        z
          .object({
            key: entryKey,
            kind: z.enum(['task', 'project', 'initiative', 'program']),
            source: CopySourceIdentity,
            sourceFingerprint: fingerprint,
            dependencies: z.array(entryKey).max(99),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .transform(({ choicesFingerprint, ...rest }) => ({
    ...rest,
    choicesFingerprint: choicesFingerprint ?? rest.reviewFingerprint,
  }));
/** Authorized frozen source metadata; actual bodies stay in canonical definitions and protected receipts. */
export type CopyBundleAcceptance = z.infer<typeof acceptance>;

/** Validate the dependency-first bounded graph before reserving any canonical destination identity. */
export function parseCopyBundleAcceptance(input: unknown): CopyBundleAcceptance {
  const parsed = acceptance.parse(input);
  validateEntries(parsed);
  validateClosure(parsed);
  return parsed;
}
function validateEntries(parsed: CopyBundleAcceptance): void {
  const previous = new Set<string>();
  const sourceKeys = new Set<string>();
  let edges = 0;
  for (const entry of parsed.entries) {
    const identity = copyIdentityKey(entry.source);
    if (
      previous.has(entry.key) ||
      sourceKeys.has(identity) ||
      invalidDependencies(entry, previous) ||
      (entry.source.kind === 'draft' && entry.source.draftFingerprint !== entry.sourceFingerprint)
    )
      invalid();
    previous.add(entry.key);
    sourceKeys.add(identity);
    edges += entry.dependencies.length;
  }
  if (edges > 2000) invalid();
}
function invalidDependencies(
  entry: CopyBundleAcceptance['entries'][number],
  previous: ReadonlySet<string>,
): boolean {
  return (
    new Set(entry.dependencies).size !== entry.dependencies.length ||
    entry.dependencies.some((key) => !previous.has(key))
  );
}
function validateClosure(parsed: CopyBundleAcceptance): void {
  const keys = new Set(parsed.entries.map((entry) => entry.key));
  if (
    new Set(parsed.roots).size !== parsed.roots.length ||
    parsed.roots.some((key) => !keys.has(key))
  )
    invalid();
  const reachable = new Set(parsed.roots);
  for (const entry of [...parsed.entries].reverse())
    if (reachable.has(entry.key))
      for (const dependency of entry.dependencies) reachable.add(dependency);
  if (reachable.size !== parsed.entries.length) invalid();
}
function invalid(): never {
  throw new ValidationError([
    { path: ['entries'], message: 'Choose one complete dependency-first copy closure.' },
  ]);
}
