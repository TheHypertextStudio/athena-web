/**
 * `@docket/boundaries` — ports + two adapters (real / mock) for every external I/O edge.
 *
 * @remarks
 * Every external dependency sits behind a typed **port** (`./ports`) with exactly two
 * adapters: a **real** env-driven one (`./real`) and a **mock/fixture** one
 * (`./mock`), selected per-port by {@link selectAdapter} (`./select`) — real when the
 * required env value is present and real-shaped, otherwise the mock. {@link
 * buildContainer} wires one adapter per port. This lets Docket run + test end-to-end
 * with zero external accounts (see `boundaries.md`). This root barrel re-exports the
 * ports, both adapter families, the deterministic fixtures, and the resolver.
 */
export * from './ports/index';
export * from './mock/index';
export * from './real/index';
export * from './fixtures/index';
export * from './select';
