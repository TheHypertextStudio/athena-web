/**
 * `@docket/types` — OAuth client display metadata DTO.
 *
 * @remarks
 * Consumed by the consent page (`/oauth/authorize`) to render the requesting client's name/icon.
 * The server is the single source: it returns the already-validated row Better Auth's OAuth
 * application table holds for the client (for CIMD clients, the `client_name`/`logo_uri` the
 * server itself fetched and validated from the client's metadata document — see
 * `apps/api/src/mcp/cimd.ts`), so the consent page never fetches or trusts anything
 * attacker-controlled directly.
 */
import { z } from 'zod';

/** Display metadata for an OAuth client, as persisted server-side. */
export const OAuthClientMetadataOut = z
  .object({
    /** The client's display name (falls back to its host for CIMD clients with no `client_name`). */
    name: z.string().describe("The OAuth client's display name."),
    /** The client's logo URL, when the client supplied one. */
    icon: z
      .string()
      .nullable()
      .describe("The OAuth client's logo URL, or null when none was supplied."),
  })
  .meta({
    id: 'OAuthClientMetadataOut',
    description: 'Server-validated display metadata for an OAuth client (consent page).',
  });
/** OAuth-client-metadata value. */
export type OAuthClientMetadataOut = z.infer<typeof OAuthClientMetadataOut>;
