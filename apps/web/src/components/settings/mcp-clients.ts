export type OS = 'mac' | 'windows' | 'linux';

export interface CliClient {
  id: string;
  name: string;
  kind: 'cli';
  command: (url: string) => string;
  note?: string;
}

export interface DeepLinkClient {
  id: string;
  name: string;
  kind: 'deeplink';
  deepLink: (url: string) => string;
  snippet: (url: string) => string;
  paths?: Partial<Record<OS, string>>;
  note?: string;
}

export interface ConfigClient {
  id: string;
  name: string;
  kind: 'config';
  snippet: (url: string) => string;
  paths?: Partial<Record<OS, string>>;
  note?: string;
}

export interface StepsClient {
  id: string;
  name: string;
  kind: 'steps';
  steps: readonly string[];
  note?: string;
}

export interface UrlClient {
  id: string;
  name: string;
  kind: 'url';
  note?: string;
}

export type McpClient = CliClient | DeepLinkClient | ConfigClient | StepsClient | UrlClient;

export const MCP_CLIENTS: McpClient[] = [
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
    name: 'Other',
    kind: 'url',
    note: 'Point your MCP-compatible client at this URL. It will handle OAuth automatically.',
  },
];

export function detectOS(): OS {
  if (typeof navigator === 'undefined') return 'mac';
  const ua = navigator.userAgent;
  if (ua.includes('Win')) return 'windows';
  if (ua.includes('Linux')) return 'linux';
  return 'mac';
}
