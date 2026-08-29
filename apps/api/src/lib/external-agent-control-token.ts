/** Signed, expiring control values used by provider-native Athena interactions. */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import type { AgentSurfaceProvider } from '@docket/integrations';

const CONTROL_TTL_MS = 7 * 24 * 60 * 60_000;

const payloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('approval'),
    provider: z.enum(['linear', 'slack', 'github', 'jira_a2a']),
    sessionId: z.string(),
    activityId: z.string(),
    decision: z.enum(['approve', 'reject']),
  }),
  z.object({
    kind: z.literal('stop'),
    provider: z.enum(['linear', 'slack', 'github', 'jira_a2a']),
    sessionId: z.string(),
  }),
  z.object({
    kind: z.literal('authentication'),
    provider: z.enum(['linear', 'slack', 'github', 'jira_a2a']),
    sessionId: z.string(),
    externalActorId: z.string(),
  }),
]);

/** One authorized provider-native control action. */
export type ExternalAgentControl = z.infer<typeof payloadSchema>;

function secret(): string {
  const value = process.env['BETTER_AUTH_SECRET'];
  if (!value) throw new TypeError('BETTER_AUTH_SECRET is required for external agent controls.');
  return value;
}

function signature(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url');
}

/** Sign one provider- and session-scoped external control. */
export function signExternalAgentControl(
  input: ExternalAgentControl,
  nowMs: number = Date.now(),
): string {
  const body = Buffer.from(
    JSON.stringify({ ...input, exp: nowMs + CONTROL_TTL_MS }),
    'utf8',
  ).toString('base64url');
  return `${body}.${signature(body)}`;
}

/** Verify one external control without trusting provider-supplied fields. */
export function verifyExternalAgentControl(
  token: string,
  nowMs: number = Date.now(),
): ExternalAgentControl | null {
  const [body, supplied] = token.split('.');
  if (!body || !supplied) return null;
  const expected = signature(body);
  const suppliedBuffer = Buffer.from(supplied, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown;
    const timed = z.object({ exp: z.number() }).and(payloadSchema).safeParse(decoded);
    if (!timed.success || timed.data.exp < nowMs) return null;
    const { exp: _exp, ...control } = timed.data;
    return control;
  } catch {
    return null;
  }
}

/** Assert a verified control belongs to the provider that delivered it. */
export function controlMatchesProvider(
  control: ExternalAgentControl,
  provider: AgentSurfaceProvider,
): boolean {
  return control.provider === provider;
}
