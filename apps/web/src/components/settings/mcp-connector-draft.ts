/** A concise, editable connector identity derived from its server URL. */
export interface McpConnectorDraft {
  /** Human-readable provider name. */
  label: string;
  /** Stable tool namespace. */
  alias: string;
}

const GENERIC_HOST_PARTS = new Set(['api', 'app', 'mcp', 'tools', 'www']);

/**
 * Suggest a connector name and namespace without overwriting an operator's choices.
 *
 * @param url - The remote MCP server URL entered by the operator.
 * @param current - Values the operator has already authored.
 * @returns A complete draft when the URL contains a provider host, otherwise the current values.
 */
export function deriveMcpConnectorDraft(
  url: string,
  current: Partial<McpConnectorDraft> = {},
): McpConnectorDraft {
  const label = current.label ?? '';
  const alias = current.alias ?? '';

  try {
    const hostParts = new URL(url).hostname.split('.').filter(Boolean);
    const provider = hostParts.find((part) => !GENERIC_HOST_PARTS.has(part.toLowerCase()));
    if (!provider) return { label, alias };

    const suggestedAlias = provider
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/^_+/, '');
    const suggestedLabel = suggestedAlias
      .split('_')
      .filter(Boolean)
      .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
      .join(' ');

    return {
      label: label || suggestedLabel,
      alias: alias || suggestedAlias,
    };
  } catch {
    return { label, alias };
  }
}
