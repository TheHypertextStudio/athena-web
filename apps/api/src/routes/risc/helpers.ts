/**
 * RISC route helpers.
 *
 * @packageDocumentation
 */

import type { Context } from 'hono';
import { z } from '@hono/zod-openapi';

const formTokenSchema = z
  .object({
    assertion: z.string().min(1),
  })
  .loose();

const jsonTokenSchema = z
  .object({
    token: z.string().min(1).optional(),
    assertion: z.string().min(1).optional(),
  })
  .loose();

export async function extractSecurityEventToken(c: Context): Promise<string> {
  const contentType = c.req.header('content-type') ?? '';

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const formData = await c.req.parseBody();
    const parsed = formTokenSchema.safeParse(formData);
    return parsed.success ? parsed.data.assertion : '';
  }

  if (contentType.includes('application/secevent+jwt')) {
    return c.req.text();
  }

  if (contentType.includes('text/plain')) {
    return c.req.text();
  }

  const body = await c.req.json<unknown>().catch(() => null);
  const parsed = jsonTokenSchema.safeParse(body);
  if (parsed.success) {
    return parsed.data.token ?? parsed.data.assertion ?? '';
  }

  return '';
}
