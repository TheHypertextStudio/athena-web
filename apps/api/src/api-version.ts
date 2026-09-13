import version from '../api-version.json';

declare const __DOCKET_API_REVISION__: string;

/** The current public REST compatibility contract, independent of product and MCP releases. */
export const API_VERSION = version.version;
/** The contracts accepted by this deployment. */
export const SUPPORTED_API_VERSIONS: readonly string[] = [API_VERSION];
/** The optional request assertion and response compatibility header. */
export const API_VERSION_HEADER = 'Docket-Version';
/** The source revision baked into a runtime bundle; source execution is local development. */
export const API_REVISION =
  typeof __DOCKET_API_REVISION__ === 'string' ? __DOCKET_API_REVISION__ : 'dev';

/** Select the current contract only for an omitted or exact assertion. */
export function parseApiVersion(value: string | null): string | null {
  return value === null || value === API_VERSION ? API_VERSION : null;
}

/**
 * Reject production artifacts whose source revision cannot be verified.
 * @throws When the revision is not a complete 40-character hexadecimal Git SHA.
 */
export function assertProductionRevision(revision: string | undefined): void {
  if (revision === undefined || !/^[a-fA-F0-9]{40}$/.test(revision)) {
    throw new Error(
      'Production API artifacts require a full 40-character hexadecimal Git revision.',
    );
  }
}

if (process.env['NODE_ENV'] === 'production') assertProductionRevision(API_REVISION);
