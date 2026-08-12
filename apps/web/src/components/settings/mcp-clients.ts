/** Desktop operating systems covered by an app-specific MCP setup guide. */
export type OS = 'mac' | 'windows' | 'linux';

/** A setup guide that connects Docket by running a command. */
export interface CliSetupGuide {
  id: string;
  name: string;
  kind: 'cli';
  command: (url: string) => string;
  note?: string;
}

/** A setup guide that connects Docket through an app deep link. */
export interface DeepLinkSetupGuide {
  id: string;
  name: string;
  kind: 'deeplink';
  deepLink: (url: string) => string;
  snippet: (url: string) => string;
  paths?: Partial<Record<OS, string>>;
  note?: string;
}

/** A setup guide that connects Docket through a configuration file. */
export interface ConfigSetupGuide {
  id: string;
  name: string;
  kind: 'config';
  snippet: (url: string) => string;
  paths?: Partial<Record<OS, string>>;
  note?: string;
}

/** A setup guide that connects Docket through app-specific steps. */
export interface StepsSetupGuide {
  id: string;
  name: string;
  kind: 'steps';
  steps: readonly string[];
  note?: string;
}

/** The generic setup guide for every app that accepts a remote MCP URL. */
export interface UrlSetupGuide {
  id: string;
  name: string;
  kind: 'url';
  note?: string;
}

/** One convenience guide for entering Docket's MCP URL in another app. */
export type McpSetupGuide =
  | CliSetupGuide
  | DeepLinkSetupGuide
  | ConfigSetupGuide
  | StepsSetupGuide
  | UrlSetupGuide;

/** Convenience guides, not an interoperability or authorization allowlist. */
export const MCP_SETUP_GUIDES: McpSetupGuide[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    kind: 'cli',
    command: (url) => `claude mcp add docket ${url}`,
    note: 'Run this once in any terminal. The server is available globally across all projects.',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    kind: 'deeplink',
    // Cursor's official MCP install deep link: base64-encodes the server config object.
    // See https://cursor.com/docs/context/mcp/install-links
    deepLink: (url) => {
      const config = btoa(JSON.stringify({ url }));
      return `cursor://anysphere.cursor-deeplink/mcp/install?name=docket&config=${config}`;
    },
    snippet: (url) => JSON.stringify({ mcpServers: { docket: { url } } }, null, 2),
    paths: {
      mac: '~/.cursor/mcp.json',
      windows: '%USERPROFILE%\\.cursor\\mcp.json',
    },
    note: 'Global config. You can also scope it per-project with .cursor/mcp.json in your repo root.',
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    kind: 'steps',
    steps: [
      'In the chat bar, open the menu (+) and select Connectors → Manage Connectors',
      'Click the + icon and select Add custom connector',
      'Enter "Docket" as the name and paste the URL below',
      'Click Add — your browser will open to complete authorization',
      'Sign in to Docket and approve the requested permissions',
    ],
  },
  {
    id: 'codex',
    name: 'Codex',
    kind: 'config',
    // Codex configures remote (streamable HTTP) MCP servers in TOML; OAuth is a separate
    // `codex mcp login <name>` step. See https://developers.openai.com/codex/mcp
    snippet: (url) => `[mcp_servers.docket]\nurl = "${url}"`,
    paths: {
      mac: '~/.codex/config.toml',
      linux: '~/.codex/config.toml',
      windows: '%USERPROFILE%\\.codex\\config.toml',
    },
    note: 'After saving, run `codex mcp login docket` to authorize in your browser. You can scope the server per-project with .codex/config.toml in a trusted repo instead.',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    kind: 'config',
    // Windsurf uses `serverUrl` (not `url`) for HTTP MCP transports.
    snippet: (url) => JSON.stringify({ mcpServers: { docket: { serverUrl: url } } }, null, 2),
    paths: {
      mac: '~/.codeium/windsurf/mcp_config.json',
      windows: '%USERPROFILE%\\.codeium\\windsurf\\mcp_config.json',
    },
  },
  {
    id: 'other',
    name: 'Other app',
    kind: 'url',
    note: 'Use this URL in any app that supports remote MCP servers. The app will open Docket for authorization.',
  },
];

/** detectOS identifies the current desktop operating system for setup guidance. */
export function detectOS(): OS {
  if (typeof navigator === 'undefined') return 'mac';
  const ua = navigator.userAgent;
  if (ua.includes('Win')) return 'windows';
  if (ua.includes('Linux')) return 'linux';
  return 'mac';
}
