import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const [eventPath] = process.argv.slice(2);
const apiUrl = process.env['LINEAR_AGENT_SANDBOX_API_URL'];
const webhookSecret = process.env['LINEAR_AGENT_WEBHOOK_SECRET'];

if (!eventPath || !apiUrl || !webhookSecret) {
  throw new Error(
    'Usage: LINEAR_AGENT_SANDBOX_API_URL=https://... LINEAR_AGENT_WEBHOOK_SECRET=... pnpm linear-agent:sandbox-check path/to/event.json',
  );
}

const target = new URL('/internal/ingest/linear-agent', apiUrl);
const sandboxHost =
  target.hostname === 'localhost' ||
  target.hostname === '127.0.0.1' ||
  /(^|[.-])(sandbox|staging|preview)([.-]|$)/i.test(target.hostname);
if (!sandboxHost) {
  throw new Error(`Refusing to replay an Agent event against non-sandbox host ${target.hostname}.`);
}

const recorded = JSON.parse(await readFile(eventPath, 'utf8')) as Record<string, unknown>;
const rawBody = JSON.stringify({ ...recorded, webhookTimestamp: Date.now() });
const signature = createHmac('sha256', webhookSecret).update(rawBody, 'utf8').digest('hex');
const response = await fetch(target, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'linear-signature': signature,
  },
  body: rawBody,
});

const responseBody = await response.text();
if (!response.ok) {
  throw new Error(
    `Linear Agent sandbox probe failed with HTTP ${response.status}: ${responseBody}`,
  );
}

console.log(`Linear Agent sandbox probe accepted with HTTP ${response.status}.`);
