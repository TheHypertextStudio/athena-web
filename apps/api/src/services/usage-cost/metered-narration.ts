/** Scope day narration to its owner without attributing cross-workspace prose arbitrarily. */
import type { NarrateDayInput, NarrateDayResult } from '@docket/athena/digest';
import { getContainer } from '../../container';
import { withAiUsage } from './direct-calls';

/** Narrate the email digest as a person-level model call. */
export function narrateDigest(userId: string, input: NarrateDayInput): Promise<NarrateDayResult> {
  return withAiUsage({ source: 'daily_digest', userId, organizationId: null }, () =>
    getContainer().summarizer.narrateDay(input),
  );
}
/** Narrate Hub highlights as a person-level model call. */
export function narrateHighlights(
  userId: string,
  input: NarrateDayInput,
): Promise<NarrateDayResult> {
  return withAiUsage({ source: 'highlight_narration', userId, organizationId: null }, () =>
    getContainer().summarizer.narrateDay(input),
  );
}
