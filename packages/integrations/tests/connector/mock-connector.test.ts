/**
 * `MockConnector`'s base {@link Connector} surface: `connect`, `importWork`, `mirrorStatus`,
 * `linkResource`, `asWritable`/`pushTask`, and `listContainers`. The mail-actions and
 * work-graph capabilities have their own dedicated test files
 * (`connector-mail.test.ts`/`connector-work-graph.test.ts`); this covers everything else.
 */
import { describe, expect, it } from 'vitest';

import { CONNECTOR_ITEMS } from '../../src/fixtures';
import { MockConnector } from '../../src/mock-connector';

describe('MockConnector.connect', () => {
  it('always succeeds, stamping the account from externalWorkspaceId or a provider default', async () => {
    const mock = new MockConnector();
    const withWorkspace = await mock.connect({
      provider: 'github',
      referenceId: 'org_1',
      externalWorkspaceId: 'octo-corp',
    });
    expect(withWorkspace).toMatchObject({
      provider: 'github',
      status: 'connected',
      account: 'octo-corp',
    });

    const withoutWorkspace = await mock.connect({ provider: 'github', referenceId: 'org_1' });
    expect(withoutWorkspace.account).toBe('github-workspace');
  });

  it('assigns a fresh connectionId per call', async () => {
    const mock = new MockConnector();
    const first = await mock.connect({ provider: 'github', referenceId: 'o' });
    const second = await mock.connect({ provider: 'github', referenceId: 'o' });
    expect(first.connectionId).not.toBe(second.connectionId);
  });

  it('stamps a fixed external workspace identity for linear only', async () => {
    const mock = new MockConnector();
    const linear = await mock.connect({ provider: 'linear', referenceId: 'o' });
    expect(linear).toMatchObject({
      externalWorkspaceId: 'mock-linear-org',
      externalWorkspaceSlug: 'mock-linear',
      externalWorkspaceName: 'Mock Linear Workspace',
    });
    const github = await mock.connect({ provider: 'github', referenceId: 'o' });
    expect(github).not.toHaveProperty('externalWorkspaceId');
  });
});

describe('MockConnector.importWork / mirrorStatus / linkResource', () => {
  it('importWork returns the fixture items for the connected provider', async () => {
    const mock = new MockConnector();
    const items = await mock.importWork({ connectionId: 'c1', provider: 'github' });
    expect(items).toEqual(CONNECTOR_ITEMS.github);
  });

  it('mirrorStatus reports idle, sized to the fixture, anchored at the configured now', async () => {
    const mock = new MockConnector({ now: '2026-05-01T00:00:00.000Z' });
    const status = await mock.mirrorStatus({ connectionId: 'c1', provider: 'linear' });
    expect(status).toEqual({
      connectionId: 'c1',
      status: 'idle',
      lastSyncedAt: '2026-05-01T00:00:00.000Z',
      itemCount: CONNECTOR_ITEMS.linear.length,
    });
  });

  it('linkResource echoes a deterministic mock URL and reports linked', async () => {
    const mock = new MockConnector();
    const link = await mock.linkResource({
      connectionId: 'c1',
      provider: 'github',
      resourceId: 'r1',
      externalId: 'ext-1',
    });
    expect(link).toEqual({
      resourceId: 'r1',
      externalId: 'ext-1',
      externalUrl: 'https://github.mock.docket.local/ext-1',
      linked: true,
    });
  });
});

describe('MockConnector.asWritable / pushTask', () => {
  it('is defined for gtasks/notion and undefined for a read-only provider', () => {
    expect(new MockConnector({ provider: 'gtasks' }).asWritable()).toBeDefined();
    expect(new MockConnector({ provider: 'notion' }).asWritable()).toBeDefined();
    expect(new MockConnector({ provider: 'github' }).asWritable()).toBeUndefined();
  });

  it('create assigns a fresh id and echoes an advancing timestamp + etag', async () => {
    const mock = new MockConnector({ provider: 'gtasks' });
    const writable = mock.asWritable();
    if (!writable) throw new Error('expected a writable connector');
    const result = await writable.pushTask({
      connectionId: 'c1',
      provider: 'gtasks',
      op: { kind: 'create', listId: 'l1', title: 'New', completed: false },
    });
    expect(result?.externalId).toMatch(/^gtask_/);
    expect(result?.externalEtag).toMatch(/^etag_/);
  });

  it('update echoes back the same externalId', async () => {
    const mock = new MockConnector({ provider: 'gtasks' });
    const writable = mock.asWritable();
    if (!writable) throw new Error('expected a writable connector');
    const result = await writable.pushTask({
      connectionId: 'c1',
      provider: 'gtasks',
      op: { kind: 'update', listId: 'l1', externalId: 'existing-1', completed: true },
    });
    expect(result?.externalId).toBe('existing-1');
  });

  it('delete resolves undefined (no write result to echo)', async () => {
    const mock = new MockConnector({ provider: 'gtasks' });
    const writable = mock.asWritable();
    if (!writable) throw new Error('expected a writable connector');
    const result = await writable.pushTask({
      connectionId: 'c1',
      provider: 'gtasks',
      op: { kind: 'delete', listId: 'l1', externalId: 'gone-1' },
    });
    expect(result).toBeUndefined();
  });

  it('timestamps strictly advance across successive writes', async () => {
    const mock = new MockConnector({ provider: 'gtasks' });
    const writable = mock.asWritable();
    if (!writable) throw new Error('expected a writable connector');
    const first = await writable.pushTask({
      connectionId: 'c1',
      provider: 'gtasks',
      op: { kind: 'create', listId: 'l1', title: 'A', completed: false },
    });
    const second = await writable.pushTask({
      connectionId: 'c1',
      provider: 'gtasks',
      op: { kind: 'create', listId: 'l1', title: 'B', completed: false },
    });
    expect(new Date(second!.externalUpdatedAt).getTime()).toBeGreaterThan(
      new Date(first!.externalUpdatedAt).getTime(),
    );
  });
});

describe('MockConnector.listContainers', () => {
  it('returns the fixture teams for linear', async () => {
    const mock = new MockConnector();
    const containers = await mock.listContainers({ connectionId: 'c1', provider: 'linear' });
    expect(containers.length).toBeGreaterThan(0);
  });

  it('returns the fixture data sources for notion', async () => {
    const mock = new MockConnector();
    const containers = await mock.listContainers({ connectionId: 'c1', provider: 'notion' });
    expect(containers.length).toBeGreaterThan(0);
  });

  it('returns two fixture lists for gtasks', async () => {
    const mock = new MockConnector();
    const containers = await mock.listContainers({ connectionId: 'c1', provider: 'gtasks' });
    expect(containers).toEqual([
      { id: '@default', title: 'My Tasks' },
      { id: 'mock-list-work', title: 'Work' },
    ]);
  });

  it('returns empty for a provider with no container concept', async () => {
    const mock = new MockConnector();
    const containers = await mock.listContainers({ connectionId: 'c1', provider: 'github' });
    expect(containers).toEqual([]);
  });
});
