'use client';

/**
 * `settings` — the Connected Apps tab.
 *
 * @remarks
 * Shows an MCP client setup guide (dropdown → client-specific deep link or config snippet),
 * then lists every OAuth client the user has explicitly consented to — drawn from
 * `GET /v1/me/connected-apps` — with a per-client revoke button.
 *
 * Connected apps are **user-scoped** (not org-scoped): the same list appears regardless of
 * which org's settings the user is viewing. The tab is only shown in the personal workspace
 * settings (`PERSONAL_SETTINGS_SECTION_GROUPS`) to reflect this.
 */
import { EmptyState } from '@docket/ui/components';
import { Link } from '@docket/ui/icons';
import { Badge, Button, Skeleton } from '@docket/ui/primitives';
import { type JSX, useCallback, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

// ─── MCP client definitions ──────────────────────────────────────────────────

type OS = 'mac' | 'windows' | 'linux';

/** An MCP client set up via a one-shot CLI command (e.g. Claude Code). */
interface CliClient {
  id: string;
  name: string;
  kind: 'cli';
  /** Returns the shell command to run, given the MCP server URL. */
  command: (url: string) => string;
  note?: string;
}

/**
 * An MCP client with a one-click deep link that pre-fills its MCP configuration dialog,
 * plus a manual snippet fallback.
 */
interface DeepLinkClient {
  id: string;
  name: string;
  kind: 'deeplink';
  /** Returns the deep-link URL that opens the client directly to the install dialog. */
  deepLink: (url: string) => string;
  /** Returns the config snippet to paste if the deep link fails or is unavailable. */
  snippet: (url: string) => string;
  paths?: Partial<Record<OS, string>>;
  note?: string;
}

/** An MCP client configured by editing a JSON config file. */
interface ConfigClient {
  id: string;
  name: string;
  kind: 'config';
  snippet: (url: string) => string;
  paths?: Partial<Record<OS, string>>;
  note?: string;
}

/** Fallback for unknown clients — just show the server URL. */
interface UrlClient {
  id: string;
  name: string;
  kind: 'url';
  note?: string;
}

type McpClient = CliClient | DeepLinkClient | ConfigClient | UrlClient;

const MCP_CLIENTS: McpClient[] = [
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
    kind: 'config',
    snippet: (url) => JSON.stringify({ mcpServers: { docket: { url } } }, null, 2),
    paths: {
      mac: '~/Library/Application Support/Claude/claude_desktop_config.json',
      windows: '%APPDATA%\\Claude\\claude_desktop_config.json',
    },
    note: 'Merge into the existing file if you already have other servers configured.',
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

// ─── OS detection ────────────────────────────────────────────────────────────

function detectOS(): OS {
  if (typeof navigator === 'undefined') return 'mac';
  const ua = navigator.userAgent;
  if (ua.includes('Win')) return 'windows';
  if (ua.includes('Linux')) return 'linux';
  return 'mac';
}

// ─── Shared: copy-to-clipboard code block ────────────────────────────────────

function CodeBlock({ code, label = 'Copy' }: { code: string; label?: string }): JSX.Element {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    });
  }, [code]);

  return (
    <div className="bg-surface-container relative rounded-lg">
      <pre className="text-on-surface overflow-x-auto p-4 pr-24 font-mono text-sm leading-relaxed">
        <code>{code}</code>
      </pre>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={copy}
        className="absolute top-2 right-2 text-xs"
      >
        {copied ? 'Copied!' : label}
      </Button>
    </div>
  );
}

// ─── Per-kind setup panels ────────────────────────────────────────────────────

function CliSetup({ client, url }: { client: CliClient; url: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-on-surface-variant text-sm">Run this command in your terminal:</p>
      <CodeBlock code={client.command(url)} label="Copy command" />
      {client.note ? <p className="text-on-surface-variant text-xs">{client.note}</p> : null}
    </div>
  );
}

function DeepLinkSetup({
  client,
  url,
  os,
}: {
  client: DeepLinkClient;
  url: string;
  os: OS;
}): JSX.Element {
  const [showManual, setShowManual] = useState(false);
  const filePath = client.paths?.[os];

  return (
    <div className="flex flex-col gap-4">
      {/* Primary: one-click deep link */}
      <div className="flex flex-col gap-2">
        <Button asChild>
          <a href={client.deepLink(url)}>Open in {client.name}</a>
        </Button>
        <p className="text-on-surface-variant text-xs">
          Opens {client.name} and pre-fills the MCP server config — no manual editing required.
        </p>
      </div>

      {/* Fallback toggle */}
      <button
        type="button"
        onClick={() => {
          setShowManual((v) => !v);
        }}
        className="text-on-surface-variant hover:text-on-surface w-fit text-sm underline-offset-2 transition-colors hover:underline"
      >
        {showManual ? 'Hide manual setup' : 'Set up manually instead'}
      </button>

      {showManual ? (
        <div className="flex flex-col gap-3">
          <p className="text-on-surface-variant text-sm">
            Paste this into{' '}
            {filePath ? (
              <code className="bg-surface-container rounded px-1.5 py-0.5 font-mono text-xs">
                {filePath}
              </code>
            ) : (
              'your MCP config file'
            )}
            :
          </p>
          <CodeBlock code={client.snippet(url)} />
          {client.note ? <p className="text-on-surface-variant text-xs">{client.note}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function ConfigSetup({
  client,
  url,
  os,
}: {
  client: ConfigClient;
  url: string;
  os: OS;
}): JSX.Element {
  const filePath = client.paths?.[os];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-on-surface-variant text-sm">
        Paste this into{' '}
        {filePath ? (
          <code className="bg-surface-container rounded px-1.5 py-0.5 font-mono text-xs">
            {filePath}
          </code>
        ) : (
          'your MCP config file'
        )}
        :
      </p>
      <CodeBlock code={client.snippet(url)} />
      {client.note ? <p className="text-on-surface-variant text-xs">{client.note}</p> : null}
    </div>
  );
}

function UrlSetup({ client, url }: { client: UrlClient; url: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-on-surface-variant text-sm">MCP server URL:</p>
      <CodeBlock code={url} label="Copy URL" />
      {client.note ? <p className="text-on-surface-variant text-xs">{client.note}</p> : null}
    </div>
  );
}

// ─── Client setup section ─────────────────────────────────────────────────────

function ClientSetup({ mcpUrl }: { mcpUrl: string }): JSX.Element {
  const [selectedId, setSelectedId] = useState<string>('claude-code');
  const os = useMemo(() => detectOS(), []);

  const client = MCP_CLIENTS.find((c) => c.id === selectedId) ?? MCP_CLIENTS[0];
  if (!client) return <></>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="mcp-client-select" className="text-on-surface text-sm font-medium">
          Which app are you setting up?
        </label>
        <select
          id="mcp-client-select"
          value={selectedId}
          onChange={(e) => {
            setSelectedId(e.target.value);
          }}
          className="border-outline-variant bg-surface-container-low text-on-surface focus:ring-primary w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
        >
          {MCP_CLIENTS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {client.kind === 'cli' ? (
        <CliSetup client={client} url={mcpUrl} />
      ) : client.kind === 'deeplink' ? (
        <DeepLinkSetup client={client} url={mcpUrl} os={os} />
      ) : client.kind === 'config' ? (
        <ConfigSetup client={client} url={mcpUrl} os={os} />
      ) : (
        <UrlSetup client={client} url={mcpUrl} />
      )}
    </div>
  );
}

// ─── Scope labels ─────────────────────────────────────────────────────────────

/** Human-readable label for each Docket MCP scope token. */
const SCOPE_LABEL: Record<string, string> = {
  'work:read': 'Read work',
  'work:write': 'Create & update work',
  'agents:run': 'Manage agents',
  'connectors:link': 'Link external items',
};

// ─── Connected app row ────────────────────────────────────────────────────────

/** One authorized MCP client as returned by `GET /v1/me/connected-apps`. */
interface ConnectedApp {
  clientId: string;
  name: string;
  icon: string | null;
  scopes: string[];
  consentedAt: string;
}

// ─── Tab root ─────────────────────────────────────────────────────────────────

/** Props for {@link ConnectedAppsTab}. */
export interface ConnectedAppsTabProps {
  /** The active organization id (used for MCP URL derivation, not for scoping queries). */
  orgId: string;
}

/**
 * The Connected Apps settings tab — MCP client setup guide + authorized client roster.
 */
export function ConnectedAppsTab({ orgId: _orgId }: ConnectedAppsTabProps): JSX.Element {
  const mcpUrl =
    process.env['NEXT_PUBLIC_MCP_URL'] ??
    `${typeof window !== 'undefined' ? window.location.origin.replace('app.', 'api.') : ''}/mcp`;

  const appsQ = useApiQuery(
    queryKeys.connectedApps(),
    () => api.v1.me['connected-apps'].$get(),
    'Could not load connected apps.',
  );

  const apps: readonly ConnectedApp[] = appsQ.data?.items ?? [];
  const loading = appsQ.isPending;
  const loadError = appsQ.isError ? appsQ.error.message : null;

  const revoke = useApiMutation({
    mutationFn: (clientId: string) =>
      unwrap(
        () => api.v1.me['connected-apps'][':clientId'].$delete({ param: { clientId } }),
        'Could not revoke access.',
      ),
    invalidateKeys: [queryKeys.connectedApps()],
  });
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const revokeApp = useCallback(
    (clientId: string) => {
      setRevokingId(clientId);
      revoke.mutate(clientId, {
        onSettled: () => {
          setRevokingId(null);
        },
      });
    },
    [revoke],
  );

  return (
    <div className="flex flex-col gap-8">
      {/* ── Setup guide ── */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-on-surface text-sm font-medium">Connect an MCP client</h2>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            Give Claude Desktop, Cursor, or any MCP-compatible tool access to your Docket account.
          </p>
        </div>

        <ClientSetup mcpUrl={mcpUrl} />
      </section>

      <div className="border-outline-variant border-t" role="separator" />

      {/* ── Authorized clients roster ── */}
      <section className="flex flex-col gap-4" aria-label="Authorized MCP clients">
        <div className="flex flex-col gap-1">
          <h2 className="text-on-surface text-sm font-medium">Apps with access to your Docket</h2>
          <p className="text-on-surface-variant text-sm">
            Each app below can read or act on your work using the scopes you approved. Revoking
            removes all their access tokens immediately — they will need to re-authorize.
          </p>
        </div>

        {loading ? (
          <div className="flex flex-col gap-2">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-4 py-2">
                <Skeleton className="h-9 w-9 rounded-lg" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-8 w-16 rounded-md" />
              </div>
            ))}
          </div>
        ) : loadError ? (
          <p role="alert" className="text-destructive text-sm">
            {loadError}
          </p>
        ) : apps.length === 0 ? (
          <EmptyState
            icon={Link}
            title="No apps connected"
            body="When you authorize an MCP client, it appears here."
            className="border-none p-8"
          />
        ) : (
          <ul className="border-outline-variant divide-outline-variant flex flex-col divide-y rounded-lg border">
            {apps.map((app) => (
              <li key={app.clientId} className="flex items-center gap-4 px-4 py-3">
                <span className="bg-surface-container text-on-surface-variant flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-medium">
                  {app.name.charAt(0).toUpperCase()}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-on-surface truncate text-sm font-medium">{app.name}</span>
                  <div className="flex flex-wrap gap-1">
                    {app.scopes.map((scope) => (
                      <Badge key={scope} variant="secondary" className="text-xs font-normal">
                        {SCOPE_LABEL[scope] ?? scope}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={revokingId === app.clientId}
                  onClick={() => {
                    revokeApp(app.clientId);
                  }}
                >
                  {revokingId === app.clientId ? 'Revoking…' : 'Revoke'}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {revoke.isError ? (
          <p role="alert" className="text-destructive text-sm">
            {revoke.error.message}
          </p>
        ) : null}
      </section>
    </div>
  );
}
