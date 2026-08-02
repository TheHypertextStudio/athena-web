/**
 * `@docket/env` — the failure message a bad environment contract produces.
 *
 * @remarks
 * Extracted from `./api` so it can be tested directly. Inside the composition it is only
 * reachable by booting a deliberately-broken process, which is why its defensive branches — an
 * issue with no path, a Standard Schema path segment in object form — had never been exercised
 * despite being the code that runs when a deploy is misconfigured. That is exactly backwards:
 * the message an operator reads at 2am should be the best-tested string in the package.
 */
import type { StandardSchemaV1 } from '@t3-oss/env-core';

/**
 * The variable name an issue refers to.
 *
 * @remarks
 * Standard Schema allows a path segment to be either a bare key or a `{ key }` wrapper, and the
 * validation library is free to change which it emits. Handling both means an upgrade degrades
 * to a slightly less precise message rather than to `[object Object]`.
 *
 * @param issue - One validation issue.
 * @returns The variable name, or `'(unknown)'` when the issue carries no path.
 */
export function issueVarName(issue: StandardSchemaV1.Issue): string {
  const first = issue.path?.[0];
  if (first === undefined) return '(unknown)';
  const key = typeof first === 'object' && 'key' in first ? first.key : first;
  return String(key);
}

/**
 * Fail with a message that says which variables are wrong and where to fix them.
 *
 * @remarks
 * The default handler logs the raw Zod issues and throws `Invalid environment variables`, which
 * names the vars but not the file — and the resulting failure is genuinely confusing in dev, because
 * only the API process dies. `pnpm dev` keeps the web app serving 200, so the first visible symptom
 * is `/api/auth/get-session` returning 502 and the app behaving as though auth is broken. Naming the
 * file to edit, and the contract to copy from, turns a misleading multi-minute hunt into a one-line
 * fix.
 *
 * @param issues - The validation issues reported by the composed schema.
 * @throws {Error} Always — this is the fail-fast path.
 */
export function reportInvalidEnv(issues: readonly StandardSchemaV1.Issue[]): never {
  const detail = issues.map((issue) => `  - ${issueVarName(issue)}: ${issue.message}`).join('\n');
  throw new Error(
    `Invalid environment variables for the Docket API:\n${detail}\n\n` +
      'Set these in the repository-root `.env.local` (the committed local defaults) or in this ' +
      "deployment's environment. `.env.example` is the contract and carries a safe value for " +
      'every required variable — `packages/env/tests/env-files/env-files.test.ts` keeps the two in step.\n' +
      'Note: only the API refuses to boot on this. The web app will keep serving pages, so ' +
      '`/api/auth/get-session` failing is a symptom of this, not an auth bug.',
  );
}
