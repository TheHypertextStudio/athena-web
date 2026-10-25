import {
  LabelTemplateConversionConfirm,
  LabelTemplateConversionReceipt,
  type LabelTemplateConversionChoices,
} from '@docket/work/work-template-contract';
import {
  readStoredJson,
  readStoredString,
  writeStoredJson,
  clearStoredValue,
} from '@docket/ui/lib/browser-storage';
import { UserFacingError } from '@/lib/problem';

/** Account/session-bound metadata; it carries IDs and digests only, never definition or work prose. */
export interface ConversionCommandScope {
  readonly userId: string;
  readonly sessionId: string;
  readonly orgId: string;
  readonly templateId: string;
  readonly versionId: string;
}
/** One original outcome must be known before another command can replace it. */
export interface ConversionCommandOutcome {
  readonly phase: 'ready' | 'unknown';
  readonly receipt?: LabelTemplateConversionReceipt;
  readonly needsReview?: boolean;
  readonly error?: string;
  readonly choices?: LabelTemplateConversionChoices;
}
/** Read-only reconciliation and the sole canonical confirm transport. */
export interface ConversionCommandTransport {
  readonly submit: (
    request: LabelTemplateConversionConfirm,
  ) => Promise<LabelTemplateConversionReceipt>;
  readonly lookup: (requestId: string) => Promise<LabelTemplateConversionReceipt | null>;
}
/** One tab, real session and exact publication own the saved command pointer. */
export function conversionAttemptKey(scope: ConversionCommandScope): string {
  return `docket:label-conversion:${JSON.stringify([scope.userId, scope.sessionId, scope.orgId, scope.templateId, scope.versionId])}`;
}
/** Corrupt metadata is not mistaken for permission to create another command. */
export function readConversionAttempt(
  scope: ConversionCommandScope,
): LabelTemplateConversionConfirm | null {
  const key = conversionAttemptKey(scope);
  if (readStoredString(key, 'session') === null) return null;
  const parsed = LabelTemplateConversionConfirm.safeParse(readStoredJson(key, 'session'));
  if (!parsed.success)
    throw new UserFacingError(
      'This tab’s saved request could not be read. Check the affected work before starting another batch.',
    );
  return parsed.data;
}
/** Persist before a possible write and prove the browser retained the exact recoverable request. */
export function saveConversionAttempt(
  scope: ConversionCommandScope,
  choices: LabelTemplateConversionChoices,
  fingerprint: string,
): LabelTemplateConversionConfirm {
  const previous = readConversionAttempt(scope);
  const request = LabelTemplateConversionConfirm.parse({
    ...choices,
    requestId: previous?.requestId ?? crypto.randomUUID(),
    expectedReviewFingerprint: fingerprint,
  });
  writeStoredJson(conversionAttemptKey(scope), request, 'session');
  if (JSON.stringify(readConversionAttempt(scope)) !== JSON.stringify(request))
    throw new UserFacingError(
      'This browser can’t remember your request. Allow site storage, then try again.',
    );
  return request;
}
/** Explicitly begin another batch only after the previous receipt has a known outcome. */
export function clearConversionAttempt(scope: ConversionCommandScope): void {
  const key = conversionAttemptKey(scope);
  clearStoredValue(key, 'session');
  if (readStoredString(key, 'session') !== null)
    throw new UserFacingError(
      'This browser couldn’t start another batch. Your saved change is still available.',
    );
}
/** Inspect the saved server outcome without reading its original template/label sources. */
export async function resumeConversionCommand(
  scope: ConversionCommandScope,
  lookup: ConversionCommandTransport['lookup'],
): Promise<ConversionCommandOutcome> {
  const previous = readConversionAttempt(scope);
  if (!previous) return { phase: 'ready' };
  try {
    const receipt = await lookup(previous.requestId);
    return receipt
      ? { phase: 'ready', receipt: LabelTemplateConversionReceipt.parse(receipt) }
      : { phase: 'ready', choices: { labelGroupId: previous.labelGroupId, items: previous.items } };
  } catch {
    return {
      phase: 'unknown',
      error: 'We couldn’t check whether this change was saved. Check again before continuing.',
    };
  }
}
/** Keep one command identity across lost responses, reloads, stale reviews and changed retries. */
export async function confirmConversionCommand(
  scope: ConversionCommandScope,
  choices: LabelTemplateConversionChoices,
  fingerprint: string,
  transport: ConversionCommandTransport,
): Promise<ConversionCommandOutcome> {
  const request = saveConversionAttempt(scope, choices, fingerprint);
  try {
    return {
      phase: 'ready',
      receipt: LabelTemplateConversionReceipt.parse(await transport.submit(request)),
    };
  } catch (failure) {
    const checked = await resumeConversionCommand(scope, transport.lookup);
    if (checked.receipt || checked.phase === 'unknown') return checked;
    if (failure instanceof UserFacingError && failure.status === 409)
      return {
        phase: 'ready',
        needsReview: true,
        error: 'This work changed. Review the current items and labels before confirming.',
      };
    return {
      phase: 'ready',
      error: 'This change could not be saved. Your selection is still here.',
    };
  }
}
