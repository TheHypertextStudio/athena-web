'use client';

import { Button } from '@docket/ui/primitives';
import { type JSX, useCallback, useMemo, useState } from 'react';

import type {
  CliClient,
  ConfigClient,
  DeepLinkClient,
  OS,
  StepsClient,
  UrlClient,
} from './mcp-clients';
import { MCP_CLIENTS, detectOS } from './mcp-clients';

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
      <pre className="text-on-surface text-body overflow-x-auto p-4 pr-24 font-mono leading-relaxed">
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

function CliSetup({ client, url }: { client: CliClient; url: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-on-surface-variant text-body">Run this command in your terminal:</p>
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
      <div className="flex flex-col gap-2">
        <Button asChild>
          <a href={client.deepLink(url)}>Open in {client.name}</a>
        </Button>
        <p className="text-on-surface-variant text-xs">
          Opens {client.name} and pre-fills the MCP server config — no manual editing required.
        </p>
      </div>

      <button
        type="button"
        onClick={() => {
          setShowManual((v) => !v);
        }}
        className="text-on-surface-variant hover:text-on-surface text-body w-fit underline-offset-2 transition-colors hover:underline"
      >
        {showManual ? 'Hide manual setup' : 'Set up manually instead'}
      </button>

      {showManual ? (
        <div className="flex flex-col gap-3">
          <p className="text-on-surface-variant text-body">
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
      <p className="text-on-surface-variant text-body">
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

function StepsSetup({ client, url }: { client: StepsClient; url: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <ol className="text-on-surface-variant text-body flex flex-col gap-2">
        {client.steps.map((step, i) => (
          <li key={step} className="flex gap-2.5">
            <span className="bg-surface-container text-on-surface-variant flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-medium">
              {i + 1}
            </span>
            <span className="pt-px">{step}</span>
          </li>
        ))}
      </ol>
      <CodeBlock code={url} label="Copy URL" />
      {client.note ? <p className="text-on-surface-variant text-xs">{client.note}</p> : null}
    </div>
  );
}

function UrlSetup({ client, url }: { client: UrlClient; url: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-on-surface-variant text-body">MCP server URL:</p>
      <CodeBlock code={url} label="Copy URL" />
      {client.note ? <p className="text-on-surface-variant text-xs">{client.note}</p> : null}
    </div>
  );
}

export function ClientSetup({ mcpUrl }: { mcpUrl: string }): JSX.Element {
  const [selectedId, setSelectedId] = useState<string>('claude-code');
  const os = useMemo(() => detectOS(), []);

  const client = MCP_CLIENTS.find((c) => c.id === selectedId) ?? MCP_CLIENTS[0];
  if (!client) return <></>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="mcp-client-select" className="text-on-surface text-body font-medium">
          Which app are you setting up?
        </label>
        <select
          id="mcp-client-select"
          value={selectedId}
          onChange={(e) => {
            setSelectedId(e.target.value);
          }}
          className="border-outline-variant bg-surface-container-low text-on-surface focus:ring-primary text-body w-full rounded-lg border px-3 py-2 outline-none focus:ring-2"
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
      ) : client.kind === 'steps' ? (
        <StepsSetup client={client} url={mcpUrl} />
      ) : (
        <UrlSetup client={client} url={mcpUrl} />
      )}
    </div>
  );
}
