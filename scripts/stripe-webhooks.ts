/**
 * Forward Stripe test-mode billing events to Docket's local webhook handler.
 *
 * @remarks
 * `pnpm bootstrap` stores the signing secret returned by the selected Stripe CLI profile. This
 * companion process uses that same profile and event set while a developer exercises checkout.
 * Production never uses this path; it owns a registered HTTPS webhook endpoint instead.
 */
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { DOCKET_STRIPE_WEBHOOK_EVENTS } from '../packages/billing/src/provision';

/** Resolve the local billing handler and reject any non-local destination. */
export function stripeWebhookForwardUrl(apiOrigin: string): string {
  const url = new URL(apiOrigin);
  const local =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname.endsWith('.localhost');
  if (!local)
    throw new Error('The Stripe webhook listener is sandbox-only and requires localhost.');
  return `${url.origin}/internal/billing/webhook`;
}

/** Current Stripe CLI arguments for Docket's exact billing event contract. */
export function stripeListenerArgs(apiOrigin: string): readonly string[] {
  return [
    'listen',
    '--events',
    DOCKET_STRIPE_WEBHOOK_EVENTS.join(','),
    '--forward-to',
    stripeWebhookForwardUrl(apiOrigin),
  ];
}

/** Remove sandbox webhook signing secrets before forwarding Stripe CLI output. */
export function redactStripeCliOutput(value: string): string {
  return value.replace(/whsec_[A-Za-z0-9]+/gu, '[webhook signing secret redacted]');
}

/** Forward complete terminal lines while retaining an unterminated fragment for safe redaction. */
function forwardRedacted(
  stream: NodeJS.ReadableStream,
  destination: NodeJS.WritableStream,
): () => void {
  let pending = '';
  stream.on('data', (chunk: Buffer | string) => {
    pending += chunk.toString();
    const boundary = Math.max(pending.lastIndexOf('\n'), pending.lastIndexOf('\r'));
    if (boundary < 0) return;
    destination.write(redactStripeCliOutput(pending.slice(0, boundary + 1)));
    pending = pending.slice(boundary + 1);
  });
  return () => {
    if (pending) destination.write(redactStripeCliOutput(pending));
  };
}

/** Start the foreground listener so lifecycle and logs remain visible to the operator. */
export async function runStripeWebhookListener(
  apiOrigin = process.env['API_URL'] ?? 'https://api.docket.localhost',
): Promise<void> {
  const child = spawn('stripe', [...stripeListenerArgs(apiOrigin)], {
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  const flushStdout = forwardRedacted(child.stdout, process.stdout);
  const flushStderr = forwardRedacted(child.stderr, process.stderr);
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      flushStdout();
      flushStderr();
      if (signal === 'SIGINT' || signal === 'SIGTERM' || code === 0) resolve();
      else reject(new Error(`stripe listen exited with status ${String(code)}`));
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runStripeWebhookListener();
}
