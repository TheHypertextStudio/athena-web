/**
 * A long-running local stand-in for Lovelace accounts + the Lattice gateway, for driving the
 * Settings surface in a browser.
 *
 * @remarks
 * Docket's own code is never stubbed here — only the two Lovelace services Docket talks to, which
 * do not exist publicly yet (`lattice.uselovelace.com` does not resolve; no Docket OAuth client is
 * registered). The consent screen is a real HTML page with a real Approve button that performs the
 * real redirect back to Docket's callback, so the flow a person walks is the flow the code runs.
 *
 * The gateway leg relays to whatever OpenAI-compatible model server is running locally, so a turn
 * dispatched from the browser really does execute on this machine.
 *
 * ```bash
 * pnpm --filter @docket/api exec tsx tests/lattice/local-lovelace-stub.ts
 * # then run the dev stack with:
 * #   LATTICE_CLIENT_ID=client_docket_local \
 * #   LATTICE_ACCOUNTS_ISSUER=http://127.0.0.1:4571 \
 * #   LATTICE_GATEWAY_URL=http://127.0.0.1:4572 ./scripts/dev-stack.sh start
 * ```
 */
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

/** Port the accounts stand-in listens on. */
const ACCOUNTS_PORT = 4571;

/** Port the gateway stand-in listens on. */
const GATEWAY_PORT = 4572;

/** Local OpenAI-compatible model server the gateway relays to. */
const DEVICE_BASE = process.env['LATTICE_LMSTUDIO_BASE_URL'] ?? 'http://localhost:1234/v1';

/** Model the device serves with. */
const DEVICE_MODEL = process.env['LATTICE_LOCAL_MODEL'] ?? 'qwen2.5-0.5b-instruct-mlx';

/** Whether the paired device currently answers; toggled via `/__control/offline`. */
let deviceOnline = true;

/** PKCE challenges seen at the authorize endpoint, keyed by the code that will be issued. */
const challenges = new Map<string, string>();

/** Read a request body as JSON or form-encoded. */
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw === '') return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return Object.fromEntries(new URLSearchParams(raw));
  }
}

/** Read one field as a string; anything non-string reads as empty rather than `[object Object]`. */
function field(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value : '';
}

/** Send a JSON response. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Send an HTML response. */
function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
}

/** The consent page a person actually sees and clicks. */
function consentPage(scopes: readonly string[], approveHref: string, clientId: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Sign in with Lovelace</title>
<style>
 body{font-family:ui-sans-serif,system-ui,-apple-system,"IBM Plex Sans",sans-serif;background:#12100e;color:#f4efe9;
      display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
 main{max-width:30rem;padding:2.5rem;background:#1c1917;border-radius:14px}
 h1{font-size:1.5rem;font-weight:400;margin:0 0 .5rem}
 p{color:#b6aca2;line-height:1.5}
 ul{list-style:none;padding:0;margin:1.5rem 0}
 li{padding:.6rem .8rem;background:#262220;border-radius:8px;margin-bottom:.5rem;font-size:.875rem}
 a{display:inline-block;background:#e8dfd4;color:#12100e;padding:.6rem 1.2rem;border-radius:8px;
   text-decoration:none;font-weight:500}
 .muted{font-size:.8125rem;color:#8b8179;margin-top:1.5rem}
</style></head><body><main>
<h1>Authorize Docket Athena</h1>
<p><strong>Docket Athena</strong> (${clientId}) wants to use your Lovelace compute.</p>
<ul>${scopes.map((scope) => `<li>${scope}</li>`).join('')}</ul>
<a href="${approveHref}">Approve</a>
<p class="muted">Approving lets Docket run model requests on the computers you have paired with
Lattice. It cannot add or remove computers on your account.</p>
</main></body></html>`;
}

const accounts = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${String(ACCOUNTS_PORT)}`);
    if (url.pathname === '/oauth/authorize') {
      const code = `code_${randomUUID().slice(0, 8)}`;
      challenges.set(code, url.searchParams.get('code_challenge') ?? '');
      const redirect = new URL(url.searchParams.get('redirect_uri') ?? '');
      redirect.searchParams.set('code', code);
      redirect.searchParams.set('state', url.searchParams.get('state') ?? '');
      const scopes = (url.searchParams.get('scope') ?? '').split(' ').filter(Boolean);
      html(
        res,
        200,
        consentPage(scopes, redirect.toString(), url.searchParams.get('client_id') ?? ''),
      );
      return;
    }
    if (url.pathname === '/oauth/token') {
      const form = await readBody(req);
      if (form['grant_type'] === 'refresh_token') {
        json(res, 200, {
          access_token: `at_${randomUUID()}`,
          refresh_token: 'rt_local',
          expires_in: 3600,
          scope:
            'openid profile email offline_access lattice:compute:inference lattice:compute:catalog:read',
        });
        return;
      }
      const code = field(form, 'code');
      const verifier = field(form, 'code_verifier');
      if (createHash('sha256').update(verifier).digest('base64url') !== challenges.get(code)) {
        json(res, 400, { error: 'invalid_grant', error_description: 'PKCE check failed' });
        return;
      }
      challenges.delete(code);
      json(res, 200, {
        access_token: `at_${randomUUID()}`,
        refresh_token: 'rt_local',
        expires_in: 3600,
        scope:
          'openid profile email offline_access lattice:compute:inference lattice:compute:catalog:read',
      });
      return;
    }
    json(res, 404, { error: 'not_found' });
  })();
});

const gateway = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${String(GATEWAY_PORT)}`);
    if (url.pathname === '/__control/offline') {
      deviceOnline = url.searchParams.get('value') !== 'true';
      json(res, 200, { deviceOnline });
      return;
    }
    if (url.pathname === '/v1/personal-runtimes') {
      json(res, 200, {
        runtimes: [
          {
            latticeId: 'lat_thismac',
            accountId: 'acct_local',
            displayName: 'Willie’s MacBook Pro',
            executionBackend: 'local-model',
            status: deviceOnline ? 'reachable' : 'offline',
            createdAt: '2026-07-14T00:00:00.000Z',
            updatedAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
          },
          {
            latticeId: 'lat_studio',
            accountId: 'acct_local',
            displayName: 'Studio (Mac mini)',
            executionBackend: 'local-model',
            status: 'offline',
            createdAt: '2026-06-02T00:00:00.000Z',
            updatedAt: new Date().toISOString(),
            lastSeenAt: '2026-08-01T09:12:00.000Z',
          },
        ],
      });
      return;
    }
    if (url.pathname === '/v1/chat/completions') {
      const body = await readBody(req);
      if (!deviceOnline) {
        json(res, 409, { error: 'runtime_unreachable', message: 'daemon is not polling' });
        return;
      }
      const relayed = await fetch(`${DEVICE_BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: DEVICE_MODEL,
          messages: body['messages'],
          max_tokens: body['max_tokens'] ?? 256,
        }),
      });
      json(res, relayed.status, await relayed.json());
      return;
    }
    json(res, 404, { error: 'not_found' });
  })();
});

accounts.listen(ACCOUNTS_PORT, '127.0.0.1', () => {
  process.stdout.write(`lovelace accounts stub on http://127.0.0.1:${String(ACCOUNTS_PORT)}\n`);
});
gateway.listen(GATEWAY_PORT, '127.0.0.1', () => {
  process.stdout.write(`lattice gateway stub  on http://127.0.0.1:${String(GATEWAY_PORT)}\n`);
});
