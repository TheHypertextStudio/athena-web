/**
 * `@docket/integrations` — structured logging for the connector IO edge.
 *
 * @remarks
 * The connector boundary previously had NO logging, so when a sync failed an operator had
 * zero signal to diagnose it. These helpers emit a single structured line at the network
 * edge (never the access token) so failures and silent truncations are observable. Kept
 * dependency-free (plain `console`) so the boundary stays pure and portable across runtimes.
 */
import type { ConnectorProvider } from './connector';
import type { ConnectorErrorKind } from './connector-error';

/** Fields logged when a connector request fails. */
export interface ConnectorErrorLog {
  readonly provider: ConnectorProvider;
  readonly kind: ConnectorErrorKind;
  readonly method: string;
  readonly path: string;
  readonly status?: number;
}

/** Log a connector request failure as one structured `error` line (no secrets). */
export function logConnectorError(fields: ConnectorErrorLog): void {
  console.error(
    JSON.stringify({ level: 'error', source: 'connector', event: 'request_failed', ...fields }),
  );
}

/** Fields logged when a paginated import is truncated by the safety bound. */
export interface ConnectorTruncationLog {
  readonly provider: ConnectorProvider;
  readonly resource: string;
  readonly fetched: number;
  readonly maxPages: number;
}

/** Log that an import hit its page-count safety bound and may be incomplete (data loss is not silent). */
export function logConnectorTruncation(fields: ConnectorTruncationLog): void {
  console.warn(
    JSON.stringify({ level: 'warn', source: 'connector', event: 'import_truncated', ...fields }),
  );
}

/** The maximum number of pages any connector import will fetch before stopping and warning. */
export const MAX_IMPORT_PAGES = 100;
