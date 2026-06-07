import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { FIXED_NOW } from '../../src/fixtures';
import type { SessionActionBody, SessionActivity } from '../../src/ports/agent-runtime';
import { InMemoryBillingGateway } from '../../src/mock/billing';
import { MockAgentRuntime } from '../../src/mock/agent-runtime';
import { MockConnector } from '../../src/mock/connector';
import { CaptureMailer, ConsoleMailer } from '../../src/mock/mailer';
import { LocalDiskBlob } from '../../src/mock/blob';

describe('InMemoryBillingGateway', () => {
  it('completes checkout into a trialing subscription deterministically', async () => {
    const gw = new InMemoryBillingGateway();
    const { url, sessionId } = await gw.createCheckoutSession({
      referenceId: 'org_1',
      priceKey: 'team',
      successUrl: 'https://app/ok',
      cancelUrl: 'https://app/no',
    });
    expect(url).toContain(sessionId);
    const sub = await gw.getSubscription('org_1');
    expect(sub?.status).toBe('trialing');
    expect(sub?.trialEnd).toBeDefined();
    expect(gw.events[0]?.type).toBe('checkout.completed');
  });

  it('walks the full lifecycle trialing -> active -> past_due -> canceled', async () => {
    const gw = new InMemoryBillingGateway();
    await gw.createCheckoutSession({
      referenceId: 'org_1',
      priceKey: 'team',
      successUrl: 'x',
      cancelUrl: 'y',
    });
    const statuses: string[] = [];
    for (;;) {
      const ev = gw.advance('org_1');
      if (!ev) break;
      statuses.push(ev.subscription!.status);
    }
    expect(statuses).toEqual(['trialing', 'active', 'past_due', 'canceled']);
    expect(gw.advance('org_1')).toBeNull();
    const final = await gw.getSubscription('org_1');
    expect(final?.status).toBe('canceled');
  });

  it('produces identical output across two instances (deterministic)', async () => {
    const a = new InMemoryBillingGateway();
    const b = new InMemoryBillingGateway();
    const ra = await a.createCheckoutSession({
      referenceId: 'o',
      priceKey: 'p',
      successUrl: 's',
      cancelUrl: 'c',
    });
    const rb = await b.createCheckoutSession({
      referenceId: 'o',
      priceKey: 'p',
      successUrl: 's',
      cancelUrl: 'c',
    });
    expect(ra).toEqual(rb);
    expect((await a.getSubscription('o'))?.currentPeriodEnd).toEqual(
      (await b.getSubscription('o'))?.currentPeriodEnd,
    );
  });

  it('cancel emits a canceled event', async () => {
    const gw = new InMemoryBillingGateway();
    await gw.createCheckoutSession({
      referenceId: 'org_2',
      priceKey: 't',
      successUrl: 's',
      cancelUrl: 'c',
    });
    await gw.cancelSubscription('org_2');
    expect((await gw.getSubscription('org_2'))?.status).toBe('canceled');
    expect(gw.events.some((e) => e.type === 'subscription.canceled')).toBe(true);
  });

  it('cancel is a no-op when no subscription exists', async () => {
    const gw = new InMemoryBillingGateway();
    await expect(gw.cancelSubscription('missing')).resolves.toBeUndefined();
    expect(gw.events).toHaveLength(0);
    expect(await gw.getSubscription('missing')).toBeNull();
  });

  it('createCheckoutSession honors an explicit trialDays', async () => {
    const gw = new InMemoryBillingGateway({ now: FIXED_NOW, baseUrl: 'https://b.local' });
    await gw.createCheckoutSession({
      referenceId: 'org_3',
      priceKey: 'p',
      successUrl: 's',
      cancelUrl: 'c',
      trialDays: 7,
    });
    const sub = await gw.getSubscription('org_3');
    expect(sub?.trialEnd).toBe('2026-01-08T00:00:00.000Z');
  });

  it('opens a billing portal session rooted at the base URL', async () => {
    const gw = new InMemoryBillingGateway({ baseUrl: 'https://billing.test' });
    const portal = await gw.createBillingPortalSession('org_1');
    expect(portal.url).toBe('https://billing.test/portal/org_1');
  });

  it('advance is a no-op past the end of the lifecycle without a prior subscription', async () => {
    const gw = new InMemoryBillingGateway();
    // Drive the lifecycle to exhaustion starting from a bare reference id (no checkout).
    const statuses: string[] = [];
    for (;;) {
      const ev = gw.advance('bare');
      if (!ev) break;
      statuses.push(ev.subscription!.status);
    }
    expect(statuses).toEqual(['trialing', 'active', 'past_due', 'canceled']);
    expect(gw.advance('bare')).toBeNull();
  });
});

describe('MockAgentRuntime', () => {
  it('replays the scripted session with a proposed action for the approval gate', async () => {
    const runtime = new MockAgentRuntime();
    const collected: SessionActivity[] = [];
    for await (const a of runtime.startSession({ sessionId: 's1', task: 't', agent: 'athena' })) {
      collected.push(a);
    }
    expect(collected.map((a) => a.type)).toEqual(['thought', 'action', 'elicitation', 'response']);
    const action = collected.find((a) => a.type === 'action')!;
    expect(action.approval).toBe('proposed');
    expect((action.body as SessionActionBody).kind).toBe('update_task');
  });

  it('honors a custom script', async () => {
    const runtime = new MockAgentRuntime({ script: [{ type: 'response', body: 'done' }] });
    const out: SessionActivity[] = [];
    for await (const a of runtime.startSession({ sessionId: 's', task: 't', agent: 'a' }))
      out.push(a);
    expect(out).toEqual([{ type: 'response', body: 'done' }]);
  });
});

describe('MockConnector', () => {
  it('connects and imports fixture items with provenance for each provider', async () => {
    const c = new MockConnector();
    const conn = await c.connect({ provider: 'github', referenceId: 'org_1' });
    expect(conn.status).toBe('connected');
    const items = await c.importWork({ connectionId: conn.connectionId, provider: 'github' });
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.provenance.provider).toBe('github');
    expect(items[0]?.provenance.importedAt).toBe(FIXED_NOW);
  });

  it('reports a mirror status sized to the fixture', async () => {
    const c = new MockConnector();
    const status = await c.mirrorStatus({ connectionId: 'conn_1', provider: 'drive' });
    expect(status.status).toBe('idle');
    expect(status.itemCount).toBe(1);
    expect(status.lastSyncedAt).toBe(FIXED_NOW);
  });

  it('links a resource', async () => {
    const c = new MockConnector();
    const link = await c.linkResource({
      connectionId: 'conn_1',
      provider: 'linear',
      resourceId: 'r1',
      externalId: 'DOC-7',
    });
    expect(link.linked).toBe(true);
    expect(link.externalId).toBe('DOC-7');
  });
});

describe('mailers', () => {
  it('CaptureMailer records sends deterministically', async () => {
    const m = new CaptureMailer();
    await m.send({ to: 'a@b.com', subject: 'Hi', text: 'body' });
    expect(m.outbox).toHaveLength(1);
    expect(m.last()?.subject).toBe('Hi');
    expect(m.last()?.sentAt).toBe(FIXED_NOW);
    expect(m.last()?.id).toBe('msg_000001');
  });

  it('ConsoleMailer sends without throwing', async () => {
    const m = new ConsoleMailer();
    await expect(m.send({ to: 'a@b.com', subject: 'Hi', text: 'x' })).resolves.toBeUndefined();
  });
});

describe('LocalDiskBlob', () => {
  const root = mkdtempSync(join(tmpdir(), 'docket-blob-'));
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('round-trips bytes by key and returns null for missing keys', async () => {
    const blob = new LocalDiskBlob({ root });
    const data = new TextEncoder().encode('export-artifact');
    const put = await blob.put('exports/report.txt', data, 'text/plain');
    expect(put.key).toBe('exports/report.txt');
    expect(put.url).toContain('report.txt');
    const got = await blob.get('exports/report.txt');
    expect(got && new TextDecoder().decode(got)).toBe('export-artifact');
    expect(await blob.get('exports/missing.txt')).toBeNull();
  });

  it('rejects path traversal keys', async () => {
    const blob = new LocalDiskBlob({ root });
    await expect(blob.put('../escape.txt', new Uint8Array([1]))).rejects.toThrow(/unsafe key/);
  });

  it('rejects absolute keys', async () => {
    const blob = new LocalDiskBlob({ root });
    await expect(blob.put('/etc/passwd', new Uint8Array([1]))).rejects.toThrow(/unsafe key/);
  });

  it('rejects keys that normalize to traversal', async () => {
    const blob = new LocalDiskBlob({ root });
    await expect(blob.get('foo/../../escape.txt')).rejects.toThrow(/unsafe key/);
  });

  it('defaults its root to .data/exports when none is given', () => {
    const blob = new LocalDiskBlob();
    expect(blob.url('a.txt')).toContain('exports');
  });
});
