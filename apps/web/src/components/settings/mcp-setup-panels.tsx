'use client';

import { Button, Select } from '@docket/ui/primitives';
import { type JSX, useCallback, useMemo, useState } from 'react';

import type {
  CliSetupGuide,
  ConfigSetupGuide,
  DeepLinkSetupGuide,
  OS,
  StepsSetupGuide,
  UrlSetupGuide,
} from './mcp-clients';
import { MCP_SETUP_GUIDES, detectOS } from './mcp-clients';

/** One grid cell shared by both copy-button labels, so the wider one fixes the button's width. */
const STACKED_LABEL = 'col-start-1 row-start-1';

/**
 * A code snippet with a copy control.
 *
 * @remarks
 * The copy button is a flex *sibling* of the `<pre>`, not an overlay on top of it. Absolutely
 * positioning it and reserving space with padding only works while the snippet is short enough to
 * fit: `overflow-x-auto` starts the content at the left edge, so padding-right lands at the far end
 * of the scrollable content where nobody is looking, and a long line — every realistic
 * `claude mcp add docket http://<host>/mcp` — runs straight underneath the button with both left
 * unreadable. As a sibling the button owns real horizontal space that the code can never occupy, and
 * `min-w-0` lets the `<pre>` shrink below its intrinsic width so its own `overflow-x-auto` scrolls
 * the code instead of shoving the button out of the container.
 *
 * The two label states are stacked in a single grid cell so the button is always as wide as the
 * longer string. Sizing to the current label instead would make the code area reflow every time the
 * label flipped to "Copied!" — a shift the old overlay avoided only by being out of flow.
 */
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
    <div className="bg-surface-container flex items-start gap-2 rounded-lg p-3">
      <pre className="text-on-surface text-body-medium min-w-0 flex-1 overflow-x-auto py-1 font-mono leading-relaxed">
        <code>{code}</code>
      </pre>
      <Button type="button" variant="ghost" size="sm" onClick={copy} className="shrink-0 text-xs">
        <span className="grid">
          <span className={copied ? `invisible ${STACKED_LABEL}` : STACKED_LABEL}>{label}</span>
          <span className={copied ? STACKED_LABEL : `invisible ${STACKED_LABEL}`}>Copied!</span>
        </span>
      </Button>
    </div>
  );
}

function CliSetup({ client, url }: { client: CliSetupGuide; url: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-on-surface-variant text-body-medium">Run this command in your terminal:</p>
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
  client: DeepLinkSetupGuide;
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
        className="text-on-surface-variant hover:text-on-surface text-body-medium w-fit underline-offset-2 transition-colors hover:underline"
      >
        {showManual ? 'Hide manual setup' : 'Set up manually instead'}
      </button>

      {showManual ? (
        <div className="flex flex-col gap-3">
          <p className="text-on-surface-variant text-body-medium">
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
  client: ConfigSetupGuide;
  url: string;
  os: OS;
}): JSX.Element {
  const filePath = client.paths?.[os];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-on-surface-variant text-body-medium">
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

function StepsSetup({ client, url }: { client: StepsSetupGuide; url: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <ol className="text-on-surface-variant text-body-medium flex flex-col gap-2">
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

function UrlSetup({ client, url }: { client: UrlSetupGuide; url: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-on-surface-variant text-body-medium">MCP server URL:</p>
      <CodeBlock code={url} label="Copy URL" />
      {client.note ? <p className="text-on-surface-variant text-xs">{client.note}</p> : null}
    </div>
  );
}

/** ClientSetup renders optional app-specific guides plus a generic MCP URL path. */
export function ClientSetup({ mcpUrl }: { mcpUrl: string }): JSX.Element {
  const [selectedId, setSelectedId] = useState<string>('claude-code');
  const os = useMemo(() => detectOS(), []);

  const client = MCP_SETUP_GUIDES.find((guide) => guide.id === selectedId) ?? MCP_SETUP_GUIDES[0];
  if (!client) return <></>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="mcp-client-select" className="text-on-surface text-body-medium font-medium">
          Setup guide
        </label>
        <Select
          id="mcp-client-select"
          value={selectedId}
          onChange={(e) => {
            setSelectedId(e.target.value);
          }}
          className="w-full"
        >
          {MCP_SETUP_GUIDES.map((guide) => (
            <option key={guide.id} value={guide.id}>
              {guide.name}
            </option>
          ))}
        </Select>
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
