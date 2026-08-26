import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';

import type { ActorCtx, AppEnv, AuthSession } from '../../src/context';
import { onError } from '../../src/error';
import type integrationsMcpRouter from '../../src/routes/integrations-mcp';
import type personalAthenaRouter from '../../src/routes/personal-athena';
import type { unsealCredential as Unseal } from '../../src/lib/credentials';
import { assertDefined } from '@docket/test-utils';

/**
 * The stored-credential half of the requirement that API keys and other stored credentials never
 * render in plaintext in the UI, logs, or API responses.
 *
 * @remarks
 * This wants proof that a credential which is actually **stored** never leaves the server: not in
 * a response body, not in the DTO contract, not in plaintext at rest. That cannot be shown against
 * the local dev stack, because `scripts/dev-stack.sh` does not set `CREDENTIALS_ENCRYPTION_KEY` and
 * `sealCredential` refuses (409) to store anything without it — so the browser evidence in
 * `docs/design/audits/2026-08-02-credential-masking.md` can only photograph a credential being
 * *entered*. This suite closes that gap where the key can be configured.
 *
 * Both credential-storing surfaces are covered: the org connector
 * (`POST /v1/orgs/:orgId/integrations/mcp`) and the personal one
 * (`POST /v1/me/athena/connections`). Every response body is searched for the probe secret as raw
 * text rather than by inspecting known fields, so a credential leaking through a field nobody
 * thought to check still fails the test.
 */
vi.hoisted(() => {
  process.env['DATABASE_URL'] = 'pglite://memory://';
  process.env['APP_MODE'] = 'test';
  process.env['NODE_ENV'] = 'test';
  process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
  process.env['CRON_SECRET'] = 'test-cron-secret';
  process.env['SKIP_ENV_VALIDATION'] = '1';
  process.env['AGENT_MAX_TURNS'] = '8';
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = Buffer.from('7'.repeat(32)).toString('base64');
});

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

/** The fixture MCP host `MockMcpConnector` serves, so the live health check really succeeds. */
const SERVER_URL = 'https://mcp.sunsama.com/mcp';

/** The secret every response body, log line, and DTO is searched for. */
const PROBE_SECRET = 'dkt_probe_STORED_5F1C93A0B7E2';

const JSON_HEADERS = { 'content-type': 'application/json' };

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let integrationsMcp!: typeof integrationsMcpRouter;
let personalAthena!: typeof personalAthenaRouter;
let unsealCredential!: typeof Unseal;

beforeAll(async () => {
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  await installTestProductFixture(db);
  integrationsMcp = (await import('../../src/routes/integrations-mcp')).default;
  personalAthena = (await import('../../src/routes/personal-athena')).default;
  ({ unsealCredential } = await import('../../src/lib/credentials'));
});

interface Seed {
  readonly actorId: string;
  readonly orgId: string;
  readonly userId: string;
}

/** Seed one workspace with one member who may manage integrations. */
async function seedWorkspace(): Promise<Seed> {
  const slug = `cred-mask-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const [user] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `${slug}@example.com` })
    .returning({ id: schema.user.id });
  const [actor] = await db
    .insert(schema.actor)
    .values({
      organizationId: assertDefined(org).id,
      kind: 'human',
      displayName: 'Ada',
      userId: assertDefined(user).id,
    })
    .returning({ id: schema.actor.id });
  return {
    actorId: assertDefined(actor).id,
    orgId: assertDefined(org).id,
    userId: assertDefined(user).id,
  };
}

/** Mount a router behind an actor context with full capabilities. */
function orgApp(router: typeof integrationsMcpRouter, seed: Seed): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    const ctx: ActorCtx = {
      actorId: seed.actorId,
      capabilities: ['view', 'contribute', 'assign', 'manage'],
      orgId: seed.orgId,
      roleId: 'role_test',
    };
    c.set('actorCtx', ctx);
    await next();
  });
  app.route('/', router);
  app.onError(onError);
  return app;
}

/** Mount a router behind a session only, for the personal (user-owned) surface. */
function personalApp(router: typeof personalAthenaRouter, seed: Seed): Hono<AppEnv> {
  const session: AuthSession = {
    session: {
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
      id: `sess_${seed.userId}`,
      token: 'tok',
      updatedAt: new Date(),
      userId: seed.userId,
    },
    user: {
      createdAt: new Date(),
      email: 'ada@example.com',
      emailVerified: true,
      id: seed.userId,
      image: null,
      name: 'Ada',
      updatedAt: new Date(),
    },
  };
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('session', session);
    await next();
  });
  app.route('/', router);
  app.onError(onError);
  return app;
}

describe('stored credential masking', () => {
  it('never returns an org connector credential in any response body', async () => {
    const seed = await seedWorkspace();
    const app = orgApp(integrationsMcp, seed);

    const created = await app.request('/', {
      body: JSON.stringify({
        alias: 'sunsama',
        authMode: 'bearer',
        bearerToken: PROBE_SECRET,
        label: 'Sunsama',
        url: SERVER_URL,
      }),
      headers: JSON_HEADERS,
      method: 'POST',
    });
    const createdText = await created.text();
    expect(created.status, createdText).toBe(201);
    expect(createdText).not.toContain(PROBE_SECRET);

    // The connector really connected — this is a stored, healthy credential, not a dead row.
    expect(createdText).toContain('"status":"connected"');

    const listed = await app.request('/');
    const listedText = await listed.text();
    expect(listed.status).toBe(200);
    expect(listedText).not.toContain(PROBE_SECRET);

    const stored = await db
      .select()
      .from(schema.integrationCredential)
      .where(eq(schema.integrationCredential.organizationId, seed.orgId));
    expect(stored).toHaveLength(1);
    expect(assertDefined(stored[0]).ciphertext).not.toContain(PROBE_SECRET);
    expect(assertDefined(stored[0]).ciphertext.startsWith('v1:gcm:')).toBe(true);
    expect(unsealCredential(assertDefined(stored[0]).ciphertext)).toBe(PROBE_SECRET);
  });

  it('never returns a personal Athena connection credential in any response body', async () => {
    const seed = await seedWorkspace();
    const app = personalApp(personalAthena, seed);

    const created = await app.request('/connections', {
      body: JSON.stringify({
        alias: 'sunsama',
        authMode: 'bearer',
        bearerToken: PROBE_SECRET,
        name: 'Sunsama',
        url: SERVER_URL,
      }),
      headers: JSON_HEADERS,
      method: 'POST',
    });
    const createdText = await created.text();
    expect(created.status, createdText).toBe(201);
    expect(createdText).not.toContain(PROBE_SECRET);

    const listed = await app.request('/connections');
    const listedText = await listed.text();
    expect(listed.status).toBe(200);
    expect(listedText).not.toContain(PROBE_SECRET);

    const stored = await db
      .select()
      .from(schema.personalMcpCredential)
      .where(eq(schema.personalMcpCredential.ownerUserId, seed.userId));
    expect(stored).toHaveLength(1);
    expect(assertDefined(stored[0]).ciphertext).not.toContain(PROBE_SECRET);
    expect(unsealCredential(assertDefined(stored[0]).ciphertext)).toBe(PROBE_SECRET);
  });

  it('writes no credential material to stdout or stderr while storing one', async () => {
    const seed = await seedWorkspace();
    const app = orgApp(integrationsMcp, seed);
    const written: string[] = [];
    const capture = (...args: unknown[]): void => {
      written.push(args.map((arg) => String(arg)).join(' '));
    };
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(capture),
      vi.spyOn(console, 'info').mockImplementation(capture),
      vi.spyOn(console, 'warn').mockImplementation(capture),
      vi.spyOn(console, 'error').mockImplementation(capture),
      vi.spyOn(console, 'debug').mockImplementation(capture),
    ];

    try {
      const response = await app.request('/', {
        body: JSON.stringify({
          alias: 'logged',
          authMode: 'bearer',
          bearerToken: PROBE_SECRET,
          label: 'Sunsama',
          url: SERVER_URL,
        }),
        headers: JSON_HEADERS,
        method: 'POST',
      });
      expect(response.status).toBe(201);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    expect(written.filter((line) => line.includes(PROBE_SECRET))).toEqual([]);
  });
});

/**
 * Credential-shaped property names in any 2xx response body schema.
 *
 * @remarks
 * The tests above prove that the two credential-storing routes do not leak the value they were
 * given. This block widens that to the whole published contract: walk every 2xx response schema in
 * the generated OpenAPI document and fail on a property whose NAME says it carries credential
 * material. A route added next month that returns `{ apiKey }` fails here without anyone having to
 * think to write a test for it.
 */
const CREDENTIAL_NAME_PATTERN = /token|secret|apiKey|api_key|password|credential|bearer/i;

/**
 * Property names that match the pattern but carry no credential material.
 *
 * @remarks
 * Each is justified individually; the list is deliberately tiny, and anything not on it fails.
 *
 * - `oauthScope` / `scope` / `scopes` — the granted OAuth scope STRING (`work:read offline_access`).
 *   It is an authorization descriptor the UI renders to explain what a connection can do; it is
 *   not, and cannot be exchanged for, a credential.
 * - `authMode` — the enum `bearer | oauth | none`, describing HOW a connector authenticates. It
 *   matches on the substring "bearer" and is a mode selector, not a token.
 * - `tokenEndpoint`, `tokenEndpointAuthMethod`, `registrationEndpoint` — OAuth 2.1 discovery
 *   metadata (RFC 8414 field names), all public URLs and method identifiers.
 * - `hasCredential`, `credentialStatus` — booleans/enums stating WHETHER a credential is stored,
 *   which is exactly what a masked UI needs to render and reveals nothing about the value.
 * - `credentialsRef` — the credential-by-reference pointer on `IntegrationConnection` and
 *   `AgentConnection`. Its own schema description states it is "an opaque reference to the stored
 *   credential … Docket never persists the raw secret, only this pointer", and
 *   `packages/db/src/schema/crosscutting.ts:507` says the same of the row it points at. That is a
 *   documentary claim, so it is not taken on trust: the two tests above store a real credential
 *   through the real routes and scan every response body for the value as raw text, which covers
 *   this field along with every other.
 */
const CREDENTIAL_NAME_ALLOWLIST = new Set([
  'authMode',
  'credentialStatus',
  'credentialsRef',
  'hasCredential',
  'oauthScope',
  'registrationEndpoint',
  'scope',
  'scopes',
  'tokenEndpoint',
  'tokenEndpointAuthMethod',
]);

/**
 * The one place a real credential is allowed to appear in a 2xx body, named by OPERATION.
 *
 * @remarks
 * Deliberately not an entry in {@link CREDENTIAL_NAME_ALLOWLIST}: that set is keyed on the bare
 * property name and is consulted for every operation in the document, so exempting `token` there
 * would also wave through an access token, a refresh token or a reset token on any route anyone
 * adds later — the exact class of leak this block exists to catch. The exemption is therefore
 * pinned to the single operation that earns it, and any other response field named `token` still
 * fails.
 *
 * The entry itself is the current-task share token minted by `POST /v1/time/share-tokens`
 * (`TimeShareTokenCreated`). It is unlike every credential the name pattern otherwise protects,
 * which are secrets Docket *stores* and must never echo back: this one is *created by* the
 * response and can never be read again. Only a SHA-256 digest is persisted
 * (`packages/db/src/schema/time.ts`, `time_share_token.token_hash`), the owner-facing list schema
 * `TimeShareTokenOut` omits the value outright, and `tests/routes/time-share.test.ts` asserts both
 * — that what is stored is a 64-hex digest containing no part of the secret, and that the token
 * appears in no later read. Showing it exactly once, at the moment of minting, is the whole of its
 * exposure; a minted credential that is never shown is one that cannot be used.
 */
const MINTED_CREDENTIAL_RESPONSES: ReadonlySet<string> = new Set([
  'POST /v1/time/share-tokens 201 → token',
  // Description expansion returns an opaque change-set handle so the same authorized actor can
  // undo or redo that one mutation. The task route rechecks organization and actor ownership
  // before using it, so this is an operation handle rather than a provider or session credential.
  'POST /v1/orgs/{orgId}/tasks/{id}/expand 200 → undoToken',
  'POST /v1/orgs/{orgId}/tasks/{id}/expand/undo 200 → undoToken',
  // Starting a voice session mints an EPHEMERAL client secret (minutes, one session) so the
  // browser can hold its own audio link to the speech model. Returning it is the entire point of
  // the operation, and it is deliberately not Docket's provider key — that never leaves the
  // server. Scoped to this one operation so a later route on this path cannot inherit the
  // exemption.
  'POST /v1/me/athena/voice 201 → credential',
  'POST /v1/me/athena/voice 201 → clientSecret',
]);

/** Recursively collect every property name reachable from a JSON-Schema node. */
function propertyNames(node: unknown, seen = new Set<object>()): string[] {
  if (typeof node !== 'object' || node === null) return [];
  if (seen.has(node)) return [];
  seen.add(node);
  if (Array.isArray(node)) return node.flatMap((entry) => propertyNames(entry, seen));

  const found: string[] = [];
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'properties' && typeof value === 'object' && value !== null) {
      for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
        found.push(name);
        found.push(...propertyNames(child, seen));
      }
      continue;
    }
    found.push(...propertyNames(value, seen));
  }
  return found;
}

describe('the published contract never declares a credential-bearing response field', () => {
  it('has no credential-shaped property name on any 2xx response schema', async () => {
    const { generateSpecs } = await import('hono-openapi');
    const { app } = await import('../../src/app');
    const spec = (await generateSpecs(app)) as unknown as {
      components?: { schemas?: Record<string, unknown> };
      paths: Record<
        string,
        Record<string, { responses?: Record<string, { content?: Record<string, unknown> }> }>
      >;
    };

    const offenders: string[] = [];
    const exercisedExemptions = new Set<string>();
    let inspected = 0;
    for (const [path, operations] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        for (const [status, response] of Object.entries(operation.responses ?? {})) {
          if (!status.startsWith('2')) continue;
          inspected += 1;
          for (const name of propertyNames(response.content)) {
            if (!CREDENTIAL_NAME_PATTERN.test(name)) continue;
            if (CREDENTIAL_NAME_ALLOWLIST.has(name)) continue;
            const operationField = `${method.toUpperCase()} ${path} ${status} → ${name}`;
            if (MINTED_CREDENTIAL_RESPONSES.has(operationField)) {
              exercisedExemptions.add(operationField);
              continue;
            }
            offenders.push(operationField);
          }
        }
      }
    }

    // A floor, so a generator that returned an empty document could not pass this vacuously.
    expect(inspected).toBeGreaterThan(40);
    expect([...new Set(offenders)]).toEqual([]);
    // Every operation-scoped exemption must still describe a live operation. Without this, renaming
    // or deleting the minting route would leave a stale entry behind that silently pre-authorizes
    // whatever later takes that method+path — an exemption nobody re-argued for.
    expect([...exercisedExemptions].sort()).toEqual([...MINTED_CREDENTIAL_RESPONSES].sort());
  });

  it('would catch a response field named like a credential', () => {
    // Proves the walker actually reaches nested schemas rather than skimming the top level.
    const schema = {
      'application/json': {
        schema: {
          properties: {
            data: {
              items: { properties: { apiKey: { type: 'string' }, id: { type: 'string' } } },
              type: 'array',
            },
          },
          type: 'object',
        },
      },
    };
    const names = propertyNames(schema);
    expect(names).toContain('apiKey');
    expect(names.filter((name) => CREDENTIAL_NAME_PATTERN.test(name))).toEqual(['apiKey']);
  });
});
import { installTestProductFixture } from '../support/db';
