/**
 * `@docket/integrations` — the local/test delegation surface.
 *
 * @remarks
 * Stands in for a personal Lattice runtime so the standing drain can be developed and run
 * end-to-end with no relay, no pairing, and no key material. It behaves like a machine that
 * accepts work, thinks about it for one poll, and then reports back — which is the only shape
 * the drain actually depends on.
 *
 * It is deliberately not a stub that always succeeds. Work whose instruction the caller marks
 * as failing comes back `failed` with a payload, because "a delegation that went wrong leaves
 * the task recoverable" is a behavior worth being able to exercise locally rather than only in
 * a test file.
 */
import {
  DelegationUnavailableError,
  type DelegationPoll,
  type DelegationPort,
  type DelegationRequest,
  type DelegationSubmission,
} from './delegation';

/** What the mock remembers about one submission. */
interface MockDelegatedWork {
  readonly request: DelegationRequest;
  /** Polls seen so far; the first poll reports progress, the second reports the outcome. */
  polls: number;
}

/**
 * How many polls the mock spends "working" before it reports a terminal outcome.
 *
 * @remarks
 * One, not zero: a surface that finishes before the submitting transaction has even committed
 * would let the drain pass without ever exercising the running-then-finished path it exists for.
 */
const POLLS_BEFORE_TERMINAL = 1;

/** A delegation surface that runs entirely in process. */
export class MockDelegation implements DelegationPort {
  private readonly work = new Map<string, MockDelegatedWork>();
  private counter = 0;

  /**
   * Accept work and mint a deterministic work id.
   *
   * @remarks
   * Deduplicates on `logicalSubmissionId` exactly as the real surface does, so a caller whose own
   * idempotency guard fails still cannot open two units of remote work through this one.
   *
   * @param request - The work to run.
   * @returns the accepted submission.
   */
  async submit(request: DelegationRequest): Promise<DelegationSubmission> {
    await Promise.resolve();
    const existing = [...this.work.entries()].find(
      ([, held]) => held.request.logicalSubmissionId === request.logicalSubmissionId,
    );
    const workId = existing?.[0] ?? `mock-work-${(this.counter += 1)}`;
    if (!existing) this.work.set(workId, { request, polls: 0 });
    return {
      workId,
      state: 'queued',
      runtimeId: 'lat_mock_runtime',
      runtimeName: 'Mock Lattice runtime',
      deadlineAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
  }

  /**
   * Report progress, then the outcome.
   *
   * @param workId - The id {@link MockDelegation.submit} returned.
   * @returns the current state, with a result once the work has "finished".
   * @throws {DelegationUnavailableError} With `unknown_work` for an id this mock never issued.
   */
  async poll(workId: string): Promise<DelegationPoll> {
    await Promise.resolve();
    const held = this.work.get(workId);
    if (!held) throw new DelegationUnavailableError('unknown_work');
    held.polls += 1;
    if (held.polls <= POLLS_BEFORE_TERMINAL) {
      return { state: 'in_flight', nextPollAfterMs: 1_000, result: null };
    }
    const failing = held.request.instruction.includes('[fail]');
    return {
      state: failing ? 'failed' : 'completed',
      nextPollAfterMs: 0,
      result: {
        outcome: failing ? 'failed' : 'completed',
        payload: {
          outputText: failing
            ? 'The delegated run stopped before it satisfied the acceptance criteria.'
            : `Worked on: ${held.request.instruction}`,
        },
        openedAt: new Date().toISOString(),
      },
    };
  }
}
