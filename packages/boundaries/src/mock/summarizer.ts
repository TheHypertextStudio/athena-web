/**
 * `@docket/boundaries/mock` — `MockSummarizer`.
 *
 * @remarks
 * The offline {@link Summarizer} used in `APP_MODE ∈ {local,test}` and whenever
 * `ANTHROPIC_API_KEY` is absent. It renders a deterministic Markdown digest directly from
 * the observations — no model call, no clock, no randomness — so the daily-digest pipeline
 * runs end-to-end and tests can assert the exact output.
 */
import type { SummarizeInput, SummarizeResult, Summarizer } from '../ports/summarizer';

/** A deterministic, offline {@link Summarizer} that lists the day's observations. */
export class MockSummarizer implements Summarizer {
  /** {@inheritDoc Summarizer.summarize} */
  async summarize(input: SummarizeInput): Promise<SummarizeResult> {
    const greeting = input.recipientName
      ? `Hi ${input.recipientName} — here's what you did on ${input.dateLabel}:`
      : `Here's what you did on ${input.dateLabel}:`;
    const body = input.observations.length
      ? input.observations.map((o) => `- **${o.kind}** (${o.provider}): ${o.title}`).join('\n')
      : '_No tracked activity today._';
    return { markdown: `# Your daily digest\n\n${greeting}\n\n${body}` };
  }
}
