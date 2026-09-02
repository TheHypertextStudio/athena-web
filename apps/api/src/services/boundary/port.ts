/**
 * `@docket/api` — the day-boundary port: the one seam Athena asks for more evening through.
 *
 * @remarks
 * Athena owns the day plan and can see when the work still on it no longer fits before the
 * working window ends. She does **not** own the boundary itself — that belongs to whichever
 * device-control client the person runs, the same client
 * `docs/engineering/specs/curfew-integration.md` describes on the read side. Without this seam
 * the only two outcomes are a deadline that silently slips or a person who weakens their own
 * schedule by hand. With it there is a third: ask, bounded, and accept the answer.
 *
 * **The asymmetry this interface exists to make honest.** A boundary client's write surface is
 * consent-gated and *queued*: submitting returns an identifier, and the person's answer arrives
 * later, out of band. Nothing here returns a grant, because nothing on the other side can. The
 * two methods are deliberately the smallest pair that models that — {@link
 * DayBoundaryPort.submitExtensionRequest} hands over a request and gets a claim ticket,
 * {@link DayBoundaryPort.pollExtensionRequest} asks what became of it — so a real MCP client and
 * a test double satisfy exactly the same contract, and no caller can accidentally write code that
 * assumes a synchronous yes.
 *
 * **What this port may never carry.** No morning boundary, ever: there is no method here that
 * could move a wake time, and adding one would defeat the whole point of a bounded evening ask.
 * No enforcement instruction either — Docket recommends and requests; the client decides.
 */

/** The one thing Athena is ever allowed to ask a boundary client for. */
export interface BoundaryExtensionRequest {
  /**
   * How much more evening is being asked for, in minutes. The caller is responsible for the
   * ceiling; `MAX_EVENING_EXTENSION_MINUTES` in `scheduling/day-loop.ts` is where it is enforced.
   */
  readonly minutes: number;
  /**
   * Why, in the person's own product's words — application-owned copy, shown verbatim on a
   * consent prompt. Never a model's sentence and never an exception's message.
   */
  readonly reason: string;
}

/** The claim ticket a queued, consent-gated write returns instead of an answer. */
export interface BoundarySubmission {
  /** The boundary client's own identifier for the queued request; opaque to Docket. */
  readonly requestId: string;
}

/**
 * What a submitted request is currently worth.
 *
 * @remarks
 * `budget_exhausted` is separated from `denied` on purpose, because the two mean different
 * things to a loop that runs every five minutes. A denial is about *this* ask. Exhaustion is
 * about every ask for the rest of the budget's period, so it seals the whole day rather than one
 * request — see `extension-service.ts`. `unavailable` is the honest answer when the client could
 * not be reached at all: not a refusal, and not a grant.
 */
export type BoundaryRequestState =
  'pending' | 'approved' | 'denied' | 'budget_exhausted' | 'unavailable';

/** One poll's answer. */
export interface BoundaryRequestOutcome {
  readonly state: BoundaryRequestState;
  /** Whatever the client said about the outcome, for the audit trail. Never rendered as UI copy. */
  readonly detail: string | null;
}

/**
 * The whole outbound boundary surface: submit one request, poll one request.
 *
 * @remarks
 * Two methods, no more. Every extra method would be a second way for Docket to reach into
 * someone's device schedule, and the point of this step is that there is exactly one.
 */
export interface DayBoundaryPort {
  /**
   * Queue a bounded request for more evening.
   *
   * @param request - The bounded ask.
   * @returns the claim ticket to poll with.
   * @throws When the client cannot be reached or refuses the call outright. The caller treats a
   *   throw as "nothing was queued" and is free to try again on a later pass.
   */
  submitExtensionRequest(request: BoundaryExtensionRequest): Promise<BoundarySubmission>;

  /**
   * Ask what became of a queued request.
   *
   * @param requestId - The claim ticket from {@link DayBoundaryPort.submitExtensionRequest}.
   * @returns the current state; `pending` until the person answers.
   */
  pollExtensionRequest(requestId: string): Promise<BoundaryRequestOutcome>;
}
