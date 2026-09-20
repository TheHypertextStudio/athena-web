/**
 * `@docket/api` — Docket-owned HTML and browser assets for the Scalar API reference.
 *
 * The page loads no third-party resources. Scalar's pinned standalone bundle is served from the
 * API origin, while the small Docket loader owns document retries, errors, version headers, and
 * the reference's visual frame.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { API_REVISION, API_VERSION } from './api-version';
import { env } from './env';

export const SCALAR_ASSET_PATH = '/v1/docs/assets/scalar-api-reference-1.68.0.js';
const revisionLabel = API_REVISION === 'dev' ? 'dev' : API_REVISION.slice(0, 12);
const assetRevision = revisionLabel.replace(/[^a-zA-Z0-9]/g, '') || 'dev';
export const REFERENCE_SCRIPT_PATH = `/v1/docs/assets/reference.${assetRevision}.js`;
export const REFERENCE_STYLE_PATH = `/v1/docs/assets/reference.${assetRevision}.css`;
export const ADMIN_REFERENCE_SCRIPT_PATH = `/v1/docs/assets/admin-reference.${assetRevision}.js`;

let scalarScript: Uint8Array | undefined;

/** Read the exact Scalar browser bundle installed with the API. */
export function scalarBrowserScript(): Uint8Array {
  if (scalarScript) return scalarScript;
  const entry = createRequire(import.meta.url).resolve('@scalar/api-reference');
  scalarScript = readFileSync(resolve(dirname(entry), 'browser/standalone.js'));
  return scalarScript;
}

/** CSS for the Docket frame and the Scalar theme overrides. */
export const REFERENCE_CSS = `
:root {
  color-scheme: light dark;
  --docket-paper: #fbf8f2;
  --docket-ink: #24211d;
  --docket-muted: #6f685f;
  --docket-line: #ded7cc;
  --docket-accent: #b94c2f;
  --docket-panel: #f3eee6;
  --scalar-font: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --scalar-font-code: ui-monospace, "SFMono-Regular", Consolas, monospace;
  --scalar-background-1: var(--docket-paper);
  --scalar-background-2: var(--docket-panel);
  --scalar-background-3: #eae3d8;
  --scalar-color-1: var(--docket-ink);
  --scalar-color-2: var(--docket-muted);
  --scalar-color-3: #8f877d;
  --scalar-color-accent: var(--docket-accent);
  --scalar-border-color: var(--docket-line);
  --scalar-radius: 10px;
  --scalar-radius-lg: 14px;
}
* { box-sizing: border-box; }
html, body { min-width: 0; margin: 0; background: var(--docket-paper); color: var(--docket-ink); }
body { font-family: var(--scalar-font); font-size: 16px; }
.docket-header {
  position: sticky; top: 0; z-index: 100;
  min-height: 64px; padding: 10px 18px;
  display: flex; align-items: center; gap: 14px;
  background: color-mix(in srgb, var(--docket-paper) 94%, transparent);
  border-bottom: 1px solid var(--docket-line);
  backdrop-filter: blur(12px);
}
.docket-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.docket-mark {
  width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center;
  background: var(--docket-accent); color: white; font-weight: 800; flex: 0 0 auto;
}
.docket-title { font-weight: 760; letter-spacing: -0.02em; white-space: nowrap; }
.docket-version { color: var(--docket-muted); font-size: 13px; white-space: nowrap; }
.docket-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.docket-link, .docket-button {
  min-height: 44px; padding: 0 14px; border: 1px solid var(--docket-line); border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--docket-panel); color: var(--docket-ink); font: inherit; font-weight: 650;
  text-decoration: none; cursor: pointer;
}
.docket-link:hover, .docket-button:hover { border-color: var(--docket-accent); }
:focus-visible { outline: 3px solid color-mix(in srgb, var(--docket-accent) 65%, white); outline-offset: 2px; }
#reference-status { padding: 38px 22px; text-align: center; color: var(--docket-muted); }
#reference-error {
  max-width: 640px; margin: 48px auto; padding: 24px; border: 1px solid var(--docket-line);
  border-radius: 14px; background: var(--docket-panel);
}
#reference-error h1 { margin: 0 0 8px; font-size: 22px; }
#reference-error p { line-height: 1.55; }
#reference-error .docket-actions { margin: 18px 0 0; flex-wrap: wrap; }
.scalar-api-reference button:not([class*="inline"]),
.scalar-api-reference [role="button"]:not([class*="inline"]) { min-height: 44px; }
.scalar-api-reference pre, .scalar-api-reference code { max-width: 100%; overflow-x: auto; }
.darklight-reference { display: none !important; }
@media (max-width: 620px) {
  .docket-header { align-items: flex-start; flex-wrap: wrap; padding: 10px 12px; }
  .docket-version { width: 100%; padding-left: 44px; margin-top: -10px; }
  .docket-actions { position: absolute; right: 10px; top: 10px; }
  .docket-title { font-size: 15px; }
  .docket-link { padding: 0 10px; font-size: 14px; }
}
@media (prefers-color-scheme: dark) {
  :root {
    --docket-paper: #1f1c19; --docket-ink: #f5efe7; --docket-muted: #b9afa3;
    --docket-line: #453e37; --docket-accent: #e57858; --docket-panel: #2b2723;
    --scalar-background-3: #37312b; --scalar-color-3: #948a7e;
  }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; } }
`;

interface ReferencePageOptions {
  readonly source: string;
  readonly attachApiVersion: boolean;
}

function loaderPreamble(options: ReferencePageOptions): string {
  return `(() => {
  'use strict';
  const source = ${JSON.stringify(options.source)};
  const apiOrigin = ${JSON.stringify(new URL(env.API_URL).origin)};
  const apiVersion = ${JSON.stringify(API_VERSION)};
  const status = document.getElementById('reference-status');
  const app = document.getElementById('app');
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function setStatus(message) {
    if (status) status.textContent = message;
  }

  function retryDelay(response) {
    const value = response.headers.get('Retry-After');
    if (!value) return 750;
    const seconds = Number(value);
    return Number.isFinite(seconds) ? Math.min(Math.max(seconds * 1000, 0), 5000) : 750;
  }

  async function readDocument(response, controller) {
    const total = Number(response.headers.get('Content-Length'));
    const reader = response.body?.getReader();
    if (!reader) return response.json();
    const chunks = [];
    let received = 0;
    const started = Date.now();
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
      received += next.value.byteLength;
      if (Date.now() - started > 1000 && Number.isFinite(total) && total > 0) {
        setStatus('Loading API reference… ' + Math.min(99, Math.round(received / total * 100)) + '%');
      }
    }
    controller.abort();
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  async function fetchDocument() {
    let lastFailure = { category: 'network', requestId: '' };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(source, { signal: controller.signal, headers: { Accept: 'application/json' } });
        const requestId = response.headers.get('X-Request-Id') || '';
        if (!response.ok) {
          clearTimeout(timeout);
          lastFailure = { category: response.status >= 500 ? 'server' : 'request', requestId };
          if (attempt === 0 && ([408, 429].includes(response.status) || response.status >= 500)) {
            await sleep(retryDelay(response));
            continue;
          }
          throw lastFailure;
        }
        const document = await readDocument(response, controller);
        clearTimeout(timeout);
        if (!document || typeof document !== 'object' || typeof document.openapi !== 'string') {
          throw { category: 'document', requestId };
        }
        return document;
      } catch (error) {
        clearTimeout(timeout);
        if (error && typeof error === 'object' && 'category' in error) throw error;
        lastFailure = { category: error?.name === 'AbortError' ? 'timeout' : 'network', requestId: '' };
        if (attempt === 0) { await sleep(750); continue; }
      }
    }
    throw lastFailure;
  }`;
}

function loaderRuntime(options: ReferencePageOptions): string {
  return `
  function customFetch(input, init = {}) {
    const requestUrl = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    const headers = new Headers(input instanceof Request ? input.headers : init.headers);
    if (${String(options.attachApiVersion)} && requestUrl.origin === apiOrigin && requestUrl.pathname.startsWith('/v1/')) {
      headers.set('Docket-Version', apiVersion);
    }
    return fetch(input, { ...init, headers });
  }

  function showFailure(failure) {
    const escapeText = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
    const category = escapeText(failure && failure.category ? failure.category : 'runtime');
    const requestId = escapeText(failure && failure.requestId ? failure.requestId : '');
    if (status) status.hidden = true;
    app.innerHTML = '<section id="reference-error" role="alert"><h1>The API reference could not load</h1>' +
      '<p>Failure category: <strong>' + category + '</strong>.</p>' +
      (requestId ? '<p>Request ID: <code>' + requestId + '</code></p>' : '') +
      '<p>You can retry here or open the OpenAPI document directly.</p>' +
      '<div class="docket-actions"><button class="docket-button" id="reference-retry" type="button">Retry</button>' +
      '<a class="docket-link" href="' + source + '">Open JSON</a>' +
      '<a class="docket-link" href="https://clearthedocket.com/docs/developers/errors">Error guide</a></div></section>';
    document.getElementById('reference-retry')?.addEventListener('click', start);
  }

  async function start() {
    if (status) { status.hidden = false; setStatus('Loading API reference…'); }
    app.innerHTML = '';
    try {
      if (!window.Scalar || typeof window.Scalar.createApiReference !== 'function') {
        throw { category: 'asset', requestId: '' };
      }
      const specification = await fetchDocument();
      window.Scalar.createApiReference('#app', {
        content: specification,
        theme: 'none',
        layout: 'modern',
        showSidebar: true,
        defaultOpenFirstTag: false,
        defaultOpenAllTags: false,
        defaultRequestBodyView: 'form',
        operationTitleSource: 'summary',
        showOperationId: true,
        defaultHttpClient: { targetKey: 'shell', clientKey: 'curl' },
        documentDownloadType: 'none',
        hideSearch: false,
        hideTestRequestButton: false,
        hideClientButton: false,
        hideModels: true,
        modelsSectionLabel: 'Schemas',
        hideDarkModeToggle: true,
        persistAuth: false,
        telemetry: false,
        showDeveloperTools: 'never',
        withDefaultFonts: false,
        favicon: '/favicon.ico',
        agent: { disabled: true },
        customFetch,
        onLoaded: () => { if (status) status.hidden = true; window.document.documentElement.dataset.referenceReady = 'true'; },
      });
    } catch (failure) { showFailure(failure); }
  }

  start();
})();`;
}

function referenceLoader(options: ReferencePageOptions): string {
  return loaderPreamble(options) + loaderRuntime(options);
}

/** Browser loader for the public reference. */
export const REFERENCE_SCRIPT = referenceLoader({
  source: '/v1/openapi.json',
  attachApiVersion: true,
});

/** Browser loader for the staff reference. */
export const ADMIN_REFERENCE_SCRIPT = referenceLoader({
  source: '/admin/openapi.json',
  attachApiVersion: false,
});

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Render the public Docket API reference shell. */
export function publicReferenceHtml(): string {
  const title = 'Docket API Reference';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${title}</title>
  <link rel="icon" href="/favicon.ico">
  <link rel="stylesheet" href="${REFERENCE_STYLE_PATH}">
  <script defer src="${SCALAR_ASSET_PATH}"></script>
  <script defer src="${REFERENCE_SCRIPT_PATH}"></script>
</head>
<body>
  <header class="docket-header">
    <div class="docket-brand"><span class="docket-mark" aria-hidden="true">D</span><span class="docket-title">${title}</span></div>
    <span class="docket-version">API ${escapeHtml(API_VERSION)} · revision ${escapeHtml(revisionLabel)}</span>
    <nav class="docket-actions" aria-label="Reference links"><a class="docket-link" href="/v1/openapi.json" download>Download OpenAPI</a></nav>
  </header>
  <div id="reference-status" role="status" aria-live="polite">Loading API reference…</div>
  <main id="app" aria-label="Docket API operations"></main>
</body>
</html>`;
}

/** Render the staff reference with the same local Scalar runtime. */
export function adminReferenceHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Docket Admin API Reference</title><link rel="stylesheet" href="${REFERENCE_STYLE_PATH}"><script defer src="${SCALAR_ASSET_PATH}"></script><script defer src="${ADMIN_REFERENCE_SCRIPT_PATH}"></script></head><body><header class="docket-header"><div class="docket-brand"><span class="docket-mark" aria-hidden="true">D</span><span class="docket-title">Docket Admin API Reference</span></div><span class="docket-version">internal · revision ${escapeHtml(revisionLabel)}</span></header><div id="reference-status" role="status" aria-live="polite">Loading API reference…</div><main id="app" aria-label="Docket admin API operations"></main></body></html>`;
}
