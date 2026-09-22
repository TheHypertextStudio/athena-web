/**
 * `@docket/api` — display names for the OAuth clients that write through MCP and the REST API.
 *
 * @remarks
 * The registered name is what the person saw on the consent screen, so it is the name provenance
 * shows. Docket validated it when the client registered, and the bearer check loads it with the
 * client row. A client's own `initialize` claim is never shown as its name: anyone can claim to be
 * any client, so a client registered without a name is named by its client id instead.
 */

/**
 * A display name for a client with no `name` on file: its own host for a CIMD (URL-form)
 * `client_id`, else the raw id.
 *
 * @param clientId - The client id.
 * @returns the host of a URL-form id, or the id itself.
 */
export function fallbackClientName(clientId: string): string {
  try {
    return new URL(clientId).hostname;
  } catch {
    return clientId;
  }
}

/**
 * The display name for a client: its registered name, else a name derived from its id.
 *
 * @param clientId - The token's verified client id.
 * @param registeredName - The name the client registered with, when it gave one.
 * @returns the name to record.
 */
export function clientDisplayName(
  clientId: string,
  registeredName: string | null | undefined,
): string {
  // A blank registered name is no name, so this checks for text rather than for null.
  const name = registeredName?.trim();
  if (name) return name;
  return fallbackClientName(clientId);
}
