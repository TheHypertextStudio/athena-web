/**
 * The one announcement every domain write makes, and everything that listens for it.
 *
 * @remarks
 * A write used to reach out and call three specific things: enqueue a search-index job, notify MCP
 * subscribers, and reconcile mention edges. Each addition made the seam import another module, and
 * the fourth would have made it import a fourth — so the seam grew a dependency on every feature
 * that cared about writes, rather than features depending on the seam.
 *
 * This inverts that. A write publishes one event and knows nothing about who listens. Subscribers
 * are registered once at the composition root, so adding a listener touches the wiring and the new
 * subscriber, never the ~40 call sites that write entities.
 *
 * Subscribers are isolated from each other and from the caller. One that throws is logged and the
 * rest still run, because a notification failing is a display bug while failing the caller's write
 * would be a lost edit.
 */

/** What happened to one entity. */
export interface EntityWriteEvent {
  /** The owning organization. */
  readonly organizationId: string;
  /** The written table, e.g. `project`. */
  readonly sourceTable: string;
  /** The written row. */
  readonly entityId: string;
  /** Whether the row was written or removed. */
  readonly operation: 'upsert' | 'delete';
}

/** Something that reacts to an entity write. */
export interface EntityWriteSubscriber {
  /** Identifies the subscriber in logs; a failure names who failed. */
  readonly name: string;
  handle(event: EntityWriteEvent): Promise<void>;
}

/** How a subscriber failure is surfaced. Injected so tests need no console spying. */
export type EntityWriteErrorReporter = (
  subscriber: string,
  event: EntityWriteEvent,
  error: unknown,
) => void;

/** The default reporter: warn, and keep going. */
const defaultReporter: EntityWriteErrorReporter = (subscriber, event, error) => {
  console.warn(`Entity-write subscriber "${subscriber}" failed`, event, error);
};

/**
 * A publish/subscribe point for entity writes.
 *
 * @remarks
 * Deliberately not a global. The composition root owns one instance and hands it to whoever
 * publishes, so a test can build its own bus with exactly the subscribers it wants to observe
 * rather than reaching around module state.
 */
export class EntityWriteBus {
  readonly #subscribers: EntityWriteSubscriber[] = [];
  readonly #report: EntityWriteErrorReporter;

  /** @param report - Where subscriber failures go. */
  constructor(report: EntityWriteErrorReporter = defaultReporter) {
    this.#report = report;
  }

  /**
   * Register a subscriber.
   *
   * @param subscriber - What to run on each write.
   * @returns This bus, so registrations chain at the composition root.
   */
  subscribe(subscriber: EntityWriteSubscriber): this {
    this.#subscribers.push(subscriber);
    return this;
  }

  /** The registered subscriber names, so wiring can be asserted rather than assumed. */
  get subscriberNames(): readonly string[] {
    return this.#subscribers.map((subscriber) => subscriber.name);
  }

  /**
   * Announce a write to every subscriber.
   *
   * @remarks
   * Awaited, and sequential per subscriber's own promise but concurrent across subscribers: the
   * caller needs derived state to be current by the time its request returns — a user who saves a
   * description and switches tabs must not race the reconcile — while one slow subscriber should
   * not serialize the others.
   *
   * @param event - What happened.
   */
  async publish(event: EntityWriteEvent): Promise<void> {
    await Promise.all(
      this.#subscribers.map(async (subscriber) => {
        try {
          await subscriber.handle(event);
        } catch (error) {
          this.#report(subscriber.name, event, error);
        }
      }),
    );
  }
}
