/**
 * `@docket/integrations` — the `ActivitySource` port (Adapter pattern).
 *
 * @remarks
 * The **poll** sibling of {@link Observer}. Both answer "what happened", and both answer it with the
 * same {@link EventDraft}s — the difference is only in how the answer is obtained. An observer is
 * handed an event and normalizes it; an activity source goes and asks. Everything downstream is
 * identical, which is the whole point: a new source is an adapter, not a second write path with its
 * own subtly different identity resolution, dedupe behaviour and fan-out.
 *
 * The port is deliberately **window-only**: a caller names a time range and a ceiling, and gets
 * drafts back. There is no cursor, no delta token and no expiry-recovery arm, because
 * {@link EventDraft.dedupeKey} plus the writer's `(organizationId, dedupeKey)` conflict clause
 * already make re-reading a window free. That trades one or two cheap provider calls per tick for
 * the guarantee that a missed window is *structurally impossible* rather than merely unlikely —
 * which matters here because the provider searches these adapters use are eventually consistent, so
 * activity legitimately arrives late and out of order. A cursor would also have added branches no
 * v1 adapter could reach, which is dead code under a coverage gate.
 *
 * Discovery is structural, through {@link Connector.asActivitySource}, matching `asWritable` /
 * `asMailActor` / `asWorkGraph`. The declarative side lives in `PROVIDER_CATALOG`'s `activity` flag
 * (and `ACTIVITY_PROVIDER_IDS`) rather than in a manifest local to this package, so provider
 * capabilities stay declared in one place.
 */
import type { SourceSystemKind } from '@docket/connections/event-contract';

import type { EventDraft } from './observer';

/** The window and ceiling for one activity pull. */
export interface ActivityPullInput {
  /** The integration the pull runs through. */
  readonly connectionId: string;
  /** Inclusive ISO-8601 lower bound. */
  readonly since: string;
  /** Exclusive ISO-8601 upper bound (the caller's `now`). */
  readonly until: string;
  /**
   * The most drafts to return.
   *
   * @remarks
   * Supplied by the caller and never defaulted here: the ceiling is a decision about cost and
   * provider quota, which belongs to whoever is scheduling the work, not to the adapter.
   */
  readonly maxDrafts: number;
}

/** What one activity pull produced. */
export interface ActivityPullResult {
  /** Canonical drafts for the window, chronological. */
  readonly drafts: readonly EventDraft[];
  /**
   * Whether {@link ActivityPullInput.maxDrafts} clipped the window.
   *
   * @remarks
   * Reported rather than silently sliced. A truncated pull means the day is *incomplete*, and a
   * surface that shows the day must be able to say so — never imply completeness it does not have.
   */
  readonly truncated: boolean;
}

/**
 * The activity-source port: pull a window of one person's own activity as canonical drafts.
 *
 * @remarks
 * Read-only with respect to both Docket and the provider. Bound to a single credential at
 * construction, like every other adapter in this package.
 */
export interface ActivitySource {
  /**
   * The canonical badge every draft from this source is stamped with.
   *
   * @remarks
   * Carried on the adapter rather than derived by the caller, because not every activity source is
   * reached through a `ConnectorProvider` — the calendar projection has no provider id to look up —
   * so one field here is cheaper than a branch in the writer. Provider-backed adapters set it from
   * the catalog constant, so it cannot drift from the provider it belongs to.
   */
  readonly sourceSystem: SourceSystemKind;

  /**
   * Pull every piece of the person's own activity in the window.
   *
   * @param input - The window and the draft ceiling.
   * @returns the drafts, and whether the ceiling clipped them.
   * @throws {ConnectorError} On auth, throttle, or provider failure — never swallowed, so the
   *   leased run records it and the person is told their source needs attention.
   */
  pullActivity(input: ActivityPullInput): Promise<ActivityPullResult>;
}
